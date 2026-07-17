import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { cn } from "@superset/ui/utils";
import {
	Bot,
	GitCompareArrows,
	Globe,
	Lock,
	LockOpen,
	MessageSquare,
	Search,
	Settings,
	TerminalSquare,
} from "lucide-react";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { FileIcon } from "renderer/lib/fileIcons";
import { getBaseName } from "renderer/lib/pathBasename";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { browserRuntimeRegistry } from "../$workspaceId/hooks/usePaneRegistry/components/BrowserPane";
import type { CommentPaneData, FilePaneData } from "../$workspaceId/types";
import {
	MIN_CANVAS_WINDOW_HEIGHT,
	MIN_CANVAS_WINDOW_WIDTH,
} from "./canvasGeometry";
import type { CanvasStore, CanvasWindow } from "./canvasStore";
import { beginCanvasTranslationGesture } from "./canvasTranslationGesture";
import { requestDismissCanvasWindow } from "./dismissCanvasWindow";
import type {
	CanvasSubagentData,
	CanvasTerminalData,
} from "./useCanvasSeeding";
import type { CanvasTerminalLifecycle } from "./useCanvasTerminalLifecycle";

interface ResizeEdges {
	left?: boolean;
	right?: boolean;
	top?: boolean;
	bottom?: boolean;
}

const RESIZE_HANDLES: Array<{
	key: string;
	edges: ResizeEdges;
	className: string;
}> = [
	{
		key: "n",
		edges: { top: true },
		className: "left-2 right-2 -top-1 h-2 cursor-ns-resize",
	},
	{
		key: "s",
		edges: { bottom: true },
		className: "left-2 right-2 -bottom-1 h-2 cursor-ns-resize",
	},
	{
		key: "w",
		edges: { left: true },
		className: "top-2 bottom-2 -left-1 w-2 cursor-ew-resize",
	},
	{
		key: "e",
		edges: { right: true },
		className: "top-2 bottom-2 -right-1 w-2 cursor-ew-resize",
	},
	{
		key: "nw",
		edges: { top: true, left: true },
		className: "-top-1 -left-1 size-3 cursor-nwse-resize",
	},
	{
		key: "ne",
		edges: { top: true, right: true },
		className: "-top-1 -right-1 size-3 cursor-nesw-resize",
	},
	{
		key: "sw",
		edges: { bottom: true, left: true },
		className: "-bottom-1 -left-1 size-3 cursor-nesw-resize",
	},
	{
		key: "se",
		edges: { bottom: true, right: true },
		className: "-bottom-1 -right-1 size-3 cursor-nwse-resize",
	},
];

function useTerminalWindowTitle(window: CanvasWindow): string {
	const data = window.data as CanvasTerminalData;
	const terminalId = window.kind === "terminal" ? data.terminalId : null;
	const runtimeTitle = useSyncExternalStore(
		useCallback(
			(callback) =>
				terminalId
					? terminalRuntimeRegistry.onTitleChange(
							terminalId,
							callback,
							window.id,
						)
					: () => {},
			[terminalId, window.id],
		),
		useCallback(
			() =>
				terminalId
					? (terminalRuntimeRegistry.getTitle(terminalId, window.id) ?? null)
					: null,
			[terminalId, window.id],
		),
	);
	if (window.kind !== "terminal") return "";
	return runtimeTitle?.trim() || data.title?.trim() || "Terminal";
}

/**
 * A draggable/resizable window on the canvas plane. Geometry lives in canvas
 * (unzoomed) coordinates; drags divide pointer deltas by the camera zoom.
 * Position updates during a drag are imperative (style writes + webview
 * relayout) — the store commit happens once on pointerup.
 */
export function CanvasWindowFrame({
	window,
	store,
	zIndex,
	isFocused,
	isSelected = false,
	workspaceLabel,
	headerExtras,
	terminalLifecycle,
	children,
}: {
	window: CanvasWindow;
	store: StoreApi<CanvasStore>;
	zIndex: number;
	isFocused: boolean;
	/** Part of the multi-select set (moves/deletes as a group). */
	isSelected?: boolean;
	workspaceLabel: string;
	/** Extra controls rendered in the title bar before the close button. */
	headerExtras?: ReactNode;
	/** When set, closing a terminal window kills its host session. */
	terminalLifecycle?: CanvasTerminalLifecycle;
	children: ReactNode;
}) {
	const frameRef = useRef<HTMLDivElement | null>(null);
	const gestureCleanupRef = useRef<(() => void) | null>(null);
	const terminalTitle = useTerminalWindowTitle(window);
	const locked = Boolean(window.locked);
	const interactionMode = useStore(store, (state) => state.interactionMode);

	useEffect(() => () => gestureCleanupRef.current?.(), []);

	const focusWindow = useCallback(() => {
		store.getState().bringToFront(window.id);
		store.getState().setFocusedWindow(window.id);
	}, [store, window.id]);

	const beginGeometryGesture = useCallback(
		(
			event: ReactPointerEvent<HTMLDivElement>,
			apply: (
				deltaX: number,
				deltaY: number,
			) => {
				x: number;
				y: number;
				width: number;
				height: number;
			},
		) => {
			if (event.button !== 0 || locked) return;
			event.preventDefault();
			event.stopPropagation();
			focusWindow();
			const frame = frameRef.current;
			if (!frame) return;
			const target = event.currentTarget;
			const pointerId = event.pointerId;
			const startX = event.clientX;
			const startY = event.clientY;
			const initial = {
				x: window.x,
				y: window.y,
				width: window.width,
				height: window.height,
			};
			let latest = initial;
			target.setPointerCapture(pointerId);
			store.getState().setGestureActive(true);
			browserRuntimeRegistry.setShellInteractionPassthrough(true);

			const handleMove = (moveEvent: PointerEvent) => {
				if (moveEvent.pointerId !== pointerId) return;
				const zoom = store.getState().camera.zoom;
				latest = apply(
					(moveEvent.clientX - startX) / zoom,
					(moveEvent.clientY - startY) / zoom,
				);
				frame.style.left = `${latest.x}px`;
				frame.style.top = `${latest.y}px`;
				frame.style.width = `${latest.width}px`;
				frame.style.height = `${latest.height}px`;
				browserRuntimeRegistry.relayoutAll();
			};
			let finished = false;
			const endGesture = (commit: boolean) => {
				if (finished) return;
				finished = true;
				gestureCleanupRef.current = null;
				target.removeEventListener("pointermove", handleMove);
				target.removeEventListener("pointerup", handleEnd);
				target.removeEventListener("pointercancel", handleEnd);
				try {
					target.releasePointerCapture(pointerId);
				} catch {
					// Capture already released.
				}
				browserRuntimeRegistry.setShellInteractionPassthrough(false);
				const moved =
					latest.x !== initial.x ||
					latest.y !== initial.y ||
					latest.width !== initial.width ||
					latest.height !== initial.height;
				if (commit && moved) {
					store.getState().pushHistory();
					store.getState().setWindowGeometry(window.id, latest);
				}
				store.getState().setGestureActive(false);
				requestAnimationFrame(() => browserRuntimeRegistry.relayoutAll());
			};
			const handleEnd = (endEvent: PointerEvent) => {
				if (endEvent.pointerId !== pointerId) return;
				endGesture(true);
			};
			gestureCleanupRef.current = () => endGesture(false);
			target.addEventListener("pointermove", handleMove);
			target.addEventListener("pointerup", handleEnd);
			target.addEventListener("pointercancel", handleEnd);
		},
		[focusWindow, store, window, locked],
	);

	const handleTitleBarPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			// A locked window never drags or joins the selection — the click
			// still focuses it via the frame's capture handler.
			if (locked) return;
			// Shift-click toggles multi-select membership instead of dragging.
			if (event.button === 0 && event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				store.getState().toggleWindowSelection(window.id);
				return;
			}
			const state = store.getState();
			// Grabbing a selected window drags the whole selection as a group.
			if (
				event.button === 0 &&
				state.selectedWindowIds.has(window.id) &&
				state.selectedWindowIds.size + state.selectedShapeIds.size > 1
			) {
				event.preventDefault();
				event.stopPropagation();
				focusWindow();
				gestureCleanupRef.current = beginCanvasTranslationGesture({
					store,
					event: event.nativeEvent,
					captureTarget: event.currentTarget,
					windowIds: [...state.selectedWindowIds],
					shapeIds: [...state.selectedShapeIds],
				});
				return;
			}
			const { x, y, width, height } = window;
			beginGeometryGesture(event, (dx, dy) => ({
				x: x + dx,
				y: y + dy,
				width,
				height,
			}));
		},
		[beginGeometryGesture, focusWindow, store, window, locked],
	);

	const makeResizeHandler = useCallback(
		(edges: ResizeEdges) => (event: ReactPointerEvent<HTMLDivElement>) => {
			const { x, y, width, height } = window;
			beginGeometryGesture(event, (dx, dy) => {
				let nextX = x;
				let nextY = y;
				let nextWidth = width;
				let nextHeight = height;
				if (edges.right) nextWidth = width + dx;
				if (edges.bottom) nextHeight = height + dy;
				if (edges.left) {
					nextWidth = width - dx;
					nextX = x + dx;
				}
				if (edges.top) {
					nextHeight = height - dy;
					nextY = y + dy;
				}
				if (nextWidth < MIN_CANVAS_WINDOW_WIDTH) {
					if (edges.left) nextX -= MIN_CANVAS_WINDOW_WIDTH - nextWidth;
					nextWidth = MIN_CANVAS_WINDOW_WIDTH;
				}
				if (nextHeight < MIN_CANVAS_WINDOW_HEIGHT) {
					if (edges.top) nextY -= MIN_CANVAS_WINDOW_HEIGHT - nextHeight;
					nextHeight = MIN_CANVAS_WINDOW_HEIGHT;
				}
				return { x: nextX, y: nextY, width: nextWidth, height: nextHeight };
			});
		},
		[beginGeometryGesture, window],
	);

	const handleDismiss = useCallback(() => {
		requestDismissCanvasWindow(store, window, { terminalLifecycle });
	}, [store, window, terminalLifecycle]);

	const handleToggleLock = useCallback(() => {
		store.getState().pushHistory();
		store.getState().setItemsLocked([window.id], [], !locked);
	}, [store, window.id, locked]);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: right-click inside a window must not open the canvas background menu */}
				<div
					ref={frameRef}
					data-canvas-window={window.id}
					className={cn(
						"absolute flex flex-col overflow-hidden rounded-lg border bg-background shadow-lg",
						isFocused ? "border-primary/60 shadow-xl" : "border-border",
						isSelected && "ring-2 ring-primary/50",
					)}
					style={{
						left: window.x,
						top: window.y,
						width: window.width,
						height: window.height,
						zIndex,
					}}
					onPointerDownCapture={(event) => {
						// A plain click on an unselected window drops the old selection —
						// shift-clicks (toggles) and clicks inside the selection keep it.
						if (
							!event.shiftKey &&
							!store.getState().selectedWindowIds.has(window.id)
						) {
							store.getState().clearSelection();
						}
						focusWindow();
					}}
					onContextMenu={(event) => event.stopPropagation()}
				>
					{/* z-20 keeps title-bar controls (close, presets) above the absolute
					    resize handles (z-10) — the ne corner handle otherwise swallows
					    most of the close button's hit area. Edge-resize still works from
					    the handle strip outside the bar. */}
					<div
						className={cn(
							"relative z-20 flex h-8 shrink-0 select-none items-center gap-1.5 border-b border-border/60 bg-muted/40 px-2",
							!locked && "cursor-grab active:cursor-grabbing",
						)}
						onPointerDown={handleTitleBarPointerDown}
					>
						<WindowIcon window={window} />
						<span className="min-w-0 truncate text-xs text-foreground">
							{window.kind === "terminal" ? terminalTitle : windowTitle(window)}
						</span>
						<span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground">
							{workspaceLabel}
						</span>
						{locked ? (
							<button
								type="button"
								className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								onPointerDown={(event) => event.stopPropagation()}
								onClick={handleToggleLock}
								title="Unlock"
							>
								<Lock aria-hidden="true" className="size-3" />
							</button>
						) : null}
						{headerExtras ? (
							<div
								className="flex shrink-0 items-center"
								onPointerDown={(event) => event.stopPropagation()}
							>
								{headerExtras}
							</div>
						) : null}
						<button
							type="button"
							className="ml-0.5 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={handleDismiss}
							title="Remove from canvas"
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 12 12"
								className="size-3"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
							>
								<path d="M3 3l6 6M9 3l-6 6" />
							</svg>
						</button>
					</div>
					<div data-canvas-window-body className="min-h-0 flex-1">
						{children}
					</div>
					{locked
						? null
						: RESIZE_HANDLES.map((handle) => (
								<div
									key={handle.key}
									className={cn("absolute z-10", handle.className)}
									onPointerDown={makeResizeHandler(handle.edges)}
								/>
							))}
					{interactionMode === "select" && !locked ? (
						// Figma-style visible corner grip: a generous SE resize target so
						// resizing is discoverable in select mode. Kept fully inside the
						// corner — the frame's overflow-hidden would clip anything outside.
						// z-30 beats the title-bar layer (z-20) and window content.
						// Locked windows can't resize, so they get no grip either.
						<div
							className="absolute bottom-0 right-0 z-30 flex size-5 cursor-nwse-resize items-end justify-end p-1"
							onPointerDown={makeResizeHandler({ bottom: true, right: true })}
						>
							<div
								className={cn(
									"size-2.5 rounded-[3px] border bg-background shadow-sm",
									isFocused || isSelected
										? "border-primary"
										: "border-muted-foreground/60",
								)}
							/>
						</div>
					) : null}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={handleToggleLock}>
					{locked ? (
						<LockOpen className="mr-2 size-4" />
					) : (
						<Lock className="mr-2 size-4" />
					)}
					{locked ? "Unlock" : "Lock"}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function subagentWindowTitle(window: CanvasWindow): string {
	const data = window.data as CanvasSubagentData;
	return data.title?.trim() || "Subagent";
}

function browserWindowTitle(window: CanvasWindow): string {
	const data = window.data as { url?: string; pageTitle?: string };
	if (data.pageTitle) return data.pageTitle;
	if (data.url && data.url !== "about:blank") {
		try {
			return new URL(data.url).host;
		} catch {
			// Fall through to the generic label.
		}
	}
	return "Browser";
}

const ICON_CLASS = "size-3.5 shrink-0 text-muted-foreground";

function WindowIcon({ window }: { window: CanvasWindow }) {
	switch (window.kind) {
		case "terminal":
			return <TerminalSquare className={ICON_CLASS} />;
		case "browser":
			return <Globe className={ICON_CLASS} />;
		case "subagent":
			return <Bot className={ICON_CLASS} />;
		case "file":
			return (
				<FileIcon
					fileName={getBaseName((window.data as FilePaneData).filePath)}
					className="size-3.5 shrink-0"
				/>
			);
		case "diff":
			return <GitCompareArrows className={ICON_CLASS} />;
		case "comment": {
			const { avatarUrl } = window.data as CommentPaneData;
			if (avatarUrl) {
				return (
					<img
						src={avatarUrl}
						alt=""
						className="size-3.5 shrink-0 rounded-full"
					/>
				);
			}
			return <MessageSquare className={ICON_CLASS} />;
		}
		case "chat":
			return <MessageSquare className={ICON_CLASS} />;
		case "search":
			return <Search className={ICON_CLASS} />;
		case "settings":
			return <Settings className={ICON_CLASS} />;
	}
}

/** Title for every kind except terminal, whose live runtime title comes from
 *  useTerminalWindowTitle. */
function windowTitle(window: CanvasWindow): string {
	switch (window.kind) {
		case "browser":
			return browserWindowTitle(window);
		case "subagent":
			return subagentWindowTitle(window);
		case "file":
			return getBaseName((window.data as FilePaneData).filePath);
		case "diff":
			return "Changes";
		case "comment":
			return (window.data as CommentPaneData).authorLogin || "Comment";
		case "chat":
			return "Chat";
		case "search":
			return "Search";
		case "settings":
			return "Settings";
		default:
			return "";
	}
}

/**
 * Stand-in for a culled (off-viewport) mirrored browser window. The webview
 * stays alive in the registry — just detached and hidden, so page state
 * survives and pan-time relayout skips it. Panning it back into view (or
 * clicking to focus) reattaches it in place.
 */
export function CanvasBrowserPlaceholder({ window }: { window: CanvasWindow }) {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background/60">
			<Globe className="size-8 text-muted-foreground/40" />
			<span className="max-w-[80%] truncate text-xs text-muted-foreground">
				{browserWindowTitle(window)}
			</span>
			<span className="text-[10px] text-muted-foreground/60">
				off-screen — click to focus
			</span>
		</div>
	);
}

/**
 * Stand-in for a culled terminal window (off-viewport, or over the
 * live-terminal cap). The runtime stays parked; clicking focuses the
 * window, which promotes it into the live set.
 */
export function CanvasTerminalPlaceholder({
	window,
	connectionHint,
}: {
	window: CanvasWindow;
	connectionHint?: string;
}) {
	const data = window.data as CanvasTerminalData;
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background/60">
			<TerminalSquare className="size-8 text-muted-foreground/40" />
			<span className="max-w-[80%] truncate text-xs text-muted-foreground">
				{data.title?.trim() || "Terminal"}
			</span>
			{connectionHint ? (
				<span className="text-[10px] text-muted-foreground/60">
					{connectionHint}
				</span>
			) : null}
		</div>
	);
}
