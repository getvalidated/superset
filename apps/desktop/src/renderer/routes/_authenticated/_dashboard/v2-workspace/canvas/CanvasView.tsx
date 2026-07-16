import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { Globe, Plus } from "lucide-react";
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import {
	EDIT_COMMAND_EVENT,
	type EditCommandEventDetail,
} from "renderer/routes/_authenticated/components/EditMenuListener";
import { DEFAULT_CANVAS_CAMERA } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { TerminalPresetShortcuts } from "../$workspaceId/components/TerminalPresetShortcuts";
import { browserRuntimeRegistry } from "../$workspaceId/hooks/usePaneRegistry/components/BrowserPane";
import type { BrowserPaneData } from "../$workspaceId/types";
import { useWorkspace } from "../providers/WorkspaceProvider";
import { CanvasDrawOverlay } from "./CanvasDrawOverlay";
import { CanvasHostProvider } from "./CanvasHostProvider";
import { CanvasShapeLayer } from "./CanvasShapeLayer";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasWindowContent } from "./CanvasWindowContent";
import {
	CanvasBrowserPlaceholder,
	CanvasTerminalPlaceholder,
	CanvasWindowFrame,
} from "./CanvasWindowFrame";
import {
	clampZoom,
	getVisibleWindowIds,
	getZoomToFitCamera,
	pickLiveTerminalWindowIds,
	zoomAtPoint,
} from "./canvasGeometry";
import {
	type CanvasStore,
	type CanvasWindow,
	getGlobalCanvasStore,
} from "./canvasStore";
import { requestDismissCanvasWindow } from "./dismissCanvasWindow";
import {
	type CanvasSearchData,
	type CanvasSettingsData,
	canvasWindowIds,
	openCanvasWindow,
} from "./openCanvasWindow";
import { isTextEntryTarget, useCanvasGestures } from "./useCanvasGestures";
import {
	CanvasSessionSeeder,
	type CanvasTerminalData,
	useCanvasBrowserMirror,
} from "./useCanvasSeeding";
import { useGlobalCanvasLayout } from "./useGlobalCanvasLayout";

/** Quiet period after a non-gesture camera write before culling resyncs. */
const CAMERA_SETTLE_MS = 120;

/**
 * One canvas window, memoized so a single-window store change (a title
 * refresh from the 15s reconcile, another window's drag commit, a focus flip)
 * doesn't re-render every frame on the plane.
 *
 * Off-screen content is culled to cheap placeholders. Terminals outside the
 * live set have their runtime parked/released by the parent; mirrored browser
 * windows unmount their BrowserPane, which detaches the webview (hidden,
 * skipped by pan-time relayoutAll) while its page state survives in the
 * registry. Ephemeral browser windows stay mounted — unmounting destroys
 * their webview outright — and the focused window always renders live.
 */
const CanvasWindowItem = memo(function CanvasWindowItem({
	window,
	store,
	zIndex,
	isFocused,
	isSelected,
	isVisible,
	isLiveTerminal,
	workspaceLabel,
	hostId,
	organizationId,
	projectId,
}: {
	window: CanvasWindow;
	store: StoreApi<CanvasStore>;
	zIndex: number;
	isFocused: boolean;
	isSelected: boolean;
	isVisible: boolean;
	isLiveTerminal: boolean;
	workspaceLabel: string;
	hostId: string | null;
	organizationId: string;
	/** Owning workspace's project, for preset matching. */
	projectId: string | null;
}) {
	const culled =
		window.kind === "terminal"
			? !isLiveTerminal
			: !isVisible && !window.ephemeral && !isFocused;
	return (
		<CanvasWindowFrame
			window={window}
			store={store}
			zIndex={zIndex}
			isFocused={isFocused}
			isSelected={isSelected}
			workspaceLabel={workspaceLabel}
			headerExtras={
				window.kind === "terminal" ? (
					<CanvasHostProvider hostId={hostId} organizationId={organizationId}>
						<TerminalPresetShortcuts
							workspaceId={window.workspaceId}
							terminalId={(window.data as CanvasTerminalData).terminalId}
							projectId={projectId}
						/>
					</CanvasHostProvider>
				) : undefined
			}
		>
			{culled ? (
				window.kind === "terminal" ? (
					<CanvasTerminalPlaceholder
						window={window}
						connectionHint={
							isVisible ? undefined : "off-screen — click to focus"
						}
					/>
				) : (
					<CanvasBrowserPlaceholder window={window} />
				)
			) : (
				<CanvasWindowContent
					window={window}
					isFocused={isFocused}
					store={store}
					hostId={hostId}
					organizationId={organizationId}
				/>
			)}
		</CanvasWindowFrame>
	);
});

/**
 * The global infinite-canvas display mode: every live terminal session
 * across all workspaces, plus mirrored browser panes, as free-floating
 * windows on a pannable/zoomable plane.
 *
 * The camera transform is applied imperatively from a store subscription so
 * pan/zoom never re-renders the React tree; window geometry only changes on
 * gesture commit.
 */
export function CanvasView({ onExit }: { onExit: () => void }) {
	const { activeOrganizationId } = useLocalHostService();
	// The canvas is org-global but always hosted by a workspace page; toolbar
	// windows that need a workspace scope (search) bind to the route workspace.
	const { workspace: routeWorkspace } = useWorkspace();
	const openNewWorkspaceModal = useOpenNewWorkspaceModal();
	const store = useMemo(
		() => getGlobalCanvasStore(activeOrganizationId ?? "default"),
		[activeOrganizationId],
	);
	useGlobalCanvasLayout(store);
	useCanvasBrowserMirror(store);

	const { workspaces } = useHostWorkspaces();
	const workspacesById = useMemo(() => {
		const byId = new Map<string, (typeof workspaces)[number]>();
		for (const workspace of workspaces) byId.set(workspace.id, workspace);
		return byId;
	}, [workspaces]);

	const viewportRef = useRef<HTMLDivElement | null>(null);
	const planeRef = useRef<HTMLDivElement | null>(null);
	const viewportSizeRef = useRef({ width: 0, height: 0 });
	const [cullTick, setCullTick] = useState(0);

	const windows = useStore(store, (state) => state.windows);
	const zOrder = useStore(store, (state) => state.zOrder);
	const focusedWindowId = useStore(store, (state) => state.focusedWindowId);
	const selectedWindowIds = useStore(store, (state) => state.selectedWindowIds);

	// Assigned below once handleGestureEnd exists; the camera effect only
	// calls it asynchronously, well after first render.
	const handleGestureEndRef = useRef<() => void>(() => {});

	// Camera → plane transform + webview relayout, no React involvement.
	// Camera writes that never pass through the gesture hook (the sidebar's
	// fit-to-workspace glide, anything else driving the store directly) get a
	// debounced settle callback of their own so culling and browser content
	// zoom catch up once the camera stops moving.
	useEffect(() => {
		const apply = () => {
			const plane = planeRef.current;
			if (!plane) return;
			const { camera } = store.getState();
			plane.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
			browserRuntimeRegistry.relayoutAll();
		};
		apply();
		let settleTimer: ReturnType<typeof setTimeout> | null = null;
		const unsubscribe = store.subscribe((state, prevState) => {
			if (state.camera === prevState.camera) return;
			apply();
			if (settleTimer) clearTimeout(settleTimer);
			if (state.gestureActive) return;
			settleTimer = setTimeout(() => {
				// A gesture that started meanwhile ends with its own resync.
				if (!store.getState().gestureActive) handleGestureEndRef.current();
			}, CAMERA_SETTLE_MS);
		});
		return () => {
			unsubscribe();
			if (settleTimer) clearTimeout(settleTimer);
		};
	}, [store]);

	// Window mounts/geometry commits move placeholders without resizing the
	// viewport — re-sync webviews after the React commit paints.
	// biome-ignore lint/correctness/useExhaustiveDependencies: windows/zOrder are re-run triggers, not effect inputs
	useLayoutEffect(() => {
		const frame = requestAnimationFrame(() =>
			browserRuntimeRegistry.relayoutAll(),
		);
		return () => cancelAnimationFrame(frame);
	}, [windows, zOrder]);

	// Track viewport size for culling math.
	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const observer = new ResizeObserver(() => {
			const rect = viewport.getBoundingClientRect();
			viewportSizeRef.current = { width: rect.width, height: rect.height };
			// Mirror into the store so out-of-view openers (sidebar clicks,
			// quick open) can place new windows inside the current viewport.
			store.getState().setViewportSize(viewportSizeRef.current);
			setCullTick((tick) => tick + 1);
		});
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [store]);

	// Every browser webview a canvas zoom has been applied to, so leaving canvas
	// mode can reset each one to 1× — including any dismissed while zoomed, which
	// never re-enter the store to be reset otherwise.
	const zoomedBrowserIdsRef = useRef<Set<string>>(new Set());
	const applyBrowserContentZoom = useCallback(() => {
		const state = store.getState();
		for (const window of Object.values(state.windows)) {
			if (window.kind !== "browser") continue;
			zoomedBrowserIdsRef.current.add(window.id);
			browserRuntimeRegistry.setContentZoom(window.id, state.camera.zoom);
		}
	}, [store]);

	// Terminals never reflow on camera zoom — geometry is in canvas
	// coordinates and the camera is a pure CSS transform, so cols/rows and
	// the PTY are untouched. This pass only re-rasterizes live xterm
	// instances at the settled zoom so their bitmaps stay crisp above 1×.
	// Runs on gesture end (the wheel path is already debounced 250ms), never
	// per frame. Runtimes mounting later (culled → live) re-apply on mount
	// in CanvasWindowContent; released runtimes drop the state with them.
	const applyTerminalRenderZoom = useCallback(() => {
		const state = store.getState();
		for (const window of Object.values(state.windows)) {
			if (window.kind !== "terminal") continue;
			const { terminalId } = window.data as CanvasTerminalData;
			terminalRuntimeRegistry.setRenderZoom(
				terminalId,
				state.camera.zoom,
				window.id,
			);
		}
	}, [store]);

	const handleGestureEnd = useCallback(() => {
		setCullTick((tick) => tick + 1);
		applyBrowserContentZoom();
		applyTerminalRenderZoom();
	}, [applyBrowserContentZoom, applyTerminalRenderZoom]);
	handleGestureEndRef.current = handleGestureEnd;

	useCanvasGestures({ viewportRef, store, onGestureEnd: handleGestureEnd });

	// Apply page zoom to browser webviews now and re-apply as new ones mirror in
	// after mount, then reset every webview touched back to 1× when leaving
	// canvas mode — the same webviews serve tabs mode.
	useEffect(() => {
		applyBrowserContentZoom();
		const unsubscribe = store.subscribe((state, prevState) => {
			if (state.windows !== prevState.windows) applyBrowserContentZoom();
		});
		return () => {
			unsubscribe();
			for (const paneId of zoomedBrowserIdsRef.current) {
				browserRuntimeRegistry.setContentZoom(paneId, 1);
			}
			zoomedBrowserIdsRef.current.clear();
		};
	}, [applyBrowserContentZoom, store]);

	const windowList = useMemo(() => Object.values(windows), [windows]);

	// First-ever seed with an untouched camera: frame everything. Held off until
	// the viewport has been measured — framing a 0×0 viewport yields the default
	// camera and would burn the one-shot, leaving the first open looking empty.
	const hadWindowsRef = useRef(windowList.length > 0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: cullTick re-runs this once the ResizeObserver reports a size
	useEffect(() => {
		if (hadWindowsRef.current || windowList.length === 0) return;
		const viewport = viewportSizeRef.current;
		if (viewport.width === 0 || viewport.height === 0) return;
		hadWindowsRef.current = true;
		const { camera } = store.getState();
		if (
			camera.x === DEFAULT_CANVAS_CAMERA.x &&
			camera.y === DEFAULT_CANVAS_CAMERA.y &&
			camera.zoom === DEFAULT_CANVAS_CAMERA.zoom
		) {
			store.getState().setCamera(getZoomToFitCamera(windowList, viewport));
			setCullTick((tick) => tick + 1);
		}
	}, [windowList, store, cullTick]);

	// Culling — recomputed on gesture end / viewport resize / window changes,
	// never per pan frame. Reads the camera imperatively on purpose.
	// biome-ignore lint/correctness/useExhaustiveDependencies: cullTick invalidates the imperative camera/viewport reads
	const { visibleIds, liveTerminalIds } = useMemo(() => {
		const camera = store.getState().camera;
		const viewport = viewportSizeRef.current;
		return {
			visibleIds: getVisibleWindowIds(windowList, camera, viewport),
			liveTerminalIds: pickLiveTerminalWindowIds({
				windows: windowList.filter((window) => window.kind === "terminal"),
				camera,
				viewport,
				focusedWindowId,
			}),
		};
	}, [windowList, focusedWindowId, cullTick, store]);

	// Windows that fell out of the live set have already swapped to
	// placeholders (TerminalPane unmounted → runtime parked). Release those
	// canvas-instance runtimes so parked WebGL contexts don't accumulate past
	// the browser's ~16-context limit while panning around — the context-loss
	// fallback would permanently flip every terminal to the DOM renderer.
	// The buffer replays from the persisted snapshot on the next mount.
	const prevLiveTerminalIdsRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		for (const windowId of prevLiveTerminalIdsRef.current) {
			if (liveTerminalIds.has(windowId)) continue;
			const window = store.getState().windows[windowId];
			if (!window || window.kind !== "terminal") continue;
			const { terminalId } = window.data as CanvasTerminalData;
			terminalRuntimeRegistry.release(terminalId, windowId);
		}
		prevLiveTerminalIdsRef.current = new Set(liveTerminalIds);
	}, [liveTerminalIds, store]);

	// Leaving canvas mode (or switching org store) unmounts every TerminalPane,
	// which only parks its runtime under the canvas instanceId — the WebGL
	// context and WebSocket stay alive. Release them all here, or tabs mode
	// mounts a second runtime per session on top of the parked ones and the
	// accumulated contexts trip the ~16-context loss fallback.
	useEffect(() => {
		return () => {
			for (const window of Object.values(store.getState().windows)) {
				if (window.kind !== "terminal") continue;
				const { terminalId } = window.data as CanvasTerminalData;
				terminalRuntimeRegistry.release(terminalId, window.id);
			}
		};
	}, [store]);

	const handleZoomStep = useCallback(
		(factor: number) => {
			const { camera } = store.getState();
			const viewport = viewportSizeRef.current;
			store
				.getState()
				.setCamera(
					zoomAtPoint(
						camera,
						{ x: viewport.width / 2, y: viewport.height / 2 },
						clampZoom(camera.zoom * factor),
					),
				);
			handleGestureEnd();
		},
		[store, handleGestureEnd],
	);

	// Canvas-native browser windows are ephemeral: they live only on the
	// canvas (no mirrored tab pane), so the mirror reconciler leaves them
	// alone and dismissal tears the webview down outright.
	const handleOpenBrowser = useCallback(() => {
		openCanvasWindow(store, {
			id: `browser:${crypto.randomUUID()}`,
			kind: "browser",
			workspaceId: routeWorkspace.id,
			data: { url: "about:blank" } satisfies BrowserPaneData,
			ephemeral: true,
		});
	}, [store, routeWorkspace.id]);

	const handleOpenSearch = useCallback(() => {
		openCanvasWindow(store, {
			id: `search:${crypto.randomUUID()}`,
			kind: "search",
			workspaceId: routeWorkspace.id,
			data: {} satisfies CanvasSearchData,
			ephemeral: true,
		});
	}, [store, routeWorkspace.id]);

	const handleOpenSettings = useCallback(() => {
		openCanvasWindow(store, {
			id: canvasWindowIds.settings(),
			kind: "settings",
			workspaceId: "",
			data: { section: "appearance" } satisfies CanvasSettingsData,
			// Re-opening focuses the existing window without resetting the
			// section it was left on.
			onExisting: "keep-data",
		});
	}, [store]);

	// Edit ▸ Undo/Redo (⌘Z/⌘⇧Z arrive as menu clicks — the accelerators never
	// reach the renderer as keydowns; EditMenuListener re-broadcasts the ones
	// no text field claimed).
	useEffect(() => {
		const handleEditCommand = (event: Event) => {
			const { command } = (event as CustomEvent<EditCommandEventDetail>).detail;
			if (command === "undo") store.getState().undo();
			else store.getState().redo();
		};
		window.addEventListener(EDIT_COMMAND_EVENT, handleEditCommand);
		return () =>
			window.removeEventListener(EDIT_COMMAND_EVENT, handleEditCommand);
	}, [store]);

	// Canvas keyboard commands — skipped while the user is typing (text
	// inputs, the xterm helper textarea):
	// - Backspace/Delete removes the multi-selection, or else the focused window
	// - ⌘Z / ⌘⇧Z undo/redo as a fallback, should the menu accelerator ever
	//   let the keydown through
	// - Escape disarms the drawing tool, then clears the selection
	// - V / H switch to select (marquee) / drag (pan) mode, Figma-style
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isTextEntryTarget(event.target)) return;
			if (
				event.target instanceof HTMLElement &&
				event.target.closest(".xterm")
			) {
				return;
			}
			const state = store.getState();
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				event.key.toLowerCase() === "z"
			) {
				event.preventDefault();
				if (event.shiftKey) state.redo();
				else state.undo();
				return;
			}
			if (event.key === "Escape") {
				if (state.activeTool !== "select") state.setActiveTool("select");
				else state.clearSelection();
				return;
			}
			if (!event.metaKey && !event.ctrlKey && !event.altKey) {
				const key = event.key.toLowerCase();
				if (key === "v" || key === "h") {
					event.preventDefault();
					state.setActiveTool("select");
					state.setInteractionMode(key === "v" ? "select" : "drag");
					return;
				}
			}
			if (event.key !== "Backspace" && event.key !== "Delete") return;
			const selectedShapeIds = [...state.selectedShapeIds];
			const selectedWindows = [...state.selectedWindowIds]
				.map((id) => state.windows[id])
				.filter((window): window is CanvasWindow => Boolean(window));
			if (selectedShapeIds.length > 0 || selectedWindows.length > 0) {
				event.preventDefault();
				// One history entry so ⌘Z restores the whole batch.
				state.pushHistory();
				state.removeShapes(selectedShapeIds);
				for (const selected of selectedWindows) {
					requestDismissCanvasWindow(store, selected, { skipHistory: true });
				}
				return;
			}
			const focused = state.focusedWindowId
				? state.windows[state.focusedWindowId]
				: null;
			// Locked windows can't be removed by a stray Backspace — unlock first
			// (the title-bar ✕ remains an explicit way out).
			if (!focused || focused.locked) return;
			event.preventDefault();
			requestDismissCanvasWindow(store, focused);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [store]);

	const handleZoomToFit = useCallback(() => {
		store
			.getState()
			.setCamera(
				getZoomToFitCamera(
					Object.values(store.getState().windows),
					viewportSizeRef.current,
				),
			);
		handleGestureEnd();
	}, [store, handleGestureEnd]);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={viewportRef}
					className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/20"
				>
					<div
						ref={planeRef}
						data-canvas-plane
						className="absolute left-0 top-0 h-0 w-0"
						style={{ transformOrigin: "0 0", willChange: "transform" }}
					>
						<CanvasShapeLayer store={store} />
						{zOrder.map((windowId, index) => {
							const window = windows[windowId];
							if (!window) return null;
							const workspace = workspacesById.get(window.workspaceId);
							return (
								<CanvasWindowItem
									key={window.id}
									window={window}
									store={store}
									zIndex={index + 1}
									isFocused={focusedWindowId === window.id}
									isSelected={selectedWindowIds.has(window.id)}
									isVisible={visibleIds.has(window.id)}
									isLiveTerminal={liveTerminalIds.has(window.id)}
									// Org-global windows (settings, "") carry no workspace label.
									workspaceLabel={
										workspace
											? `${workspace.name} · ${workspace.branch}`
											: window.workspaceId
												? "unknown workspace"
												: ""
									}
									hostId={workspace?.hostId ?? null}
									organizationId={
										workspace?.organizationId ?? activeOrganizationId ?? ""
									}
									projectId={workspace?.projectId ?? null}
								/>
							);
						})}
					</div>
					<CanvasDrawOverlay store={store} />
					<CanvasMarquee store={store} />
					<CanvasToolbar
						store={store}
						onZoomStep={handleZoomStep}
						onZoomToFit={handleZoomToFit}
						onOpenBrowser={handleOpenBrowser}
						onOpenSearch={handleOpenSearch}
						onOpenSettings={handleOpenSettings}
						onExit={onExit}
					/>
					{windowList.length === 0 ? (
						<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
							<p className="text-sm text-muted-foreground">
								Nothing on the canvas yet — open files, diffs, and search from
								the sidebar or toolbar.
							</p>
						</div>
					) : null}
					<CanvasSessionSeeder store={store} />
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem
					onSelect={() => openNewWorkspaceModal(routeWorkspace?.projectId)}
				>
					<Plus className="mr-2 size-4" />
					New workspace
				</ContextMenuItem>
				<ContextMenuItem onSelect={handleOpenBrowser}>
					<Globe className="mr-2 size-4" />
					New browser window
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

/** Marquee selection rectangle (select-mode drag, or shift-drag), drawn in
 *  viewport coordinates. */
function CanvasMarquee({ store }: { store: StoreApi<CanvasStore> }) {
	const marquee = useStore(store, (state) => state.marquee);
	if (!marquee) return null;
	return (
		<div
			className="pointer-events-none absolute z-40 rounded-sm border border-primary/70 bg-primary/10"
			style={{
				left: marquee.x,
				top: marquee.y,
				width: marquee.width,
				height: marquee.height,
			}}
		/>
	);
}
