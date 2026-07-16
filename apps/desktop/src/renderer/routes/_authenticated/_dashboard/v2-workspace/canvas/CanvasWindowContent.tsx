import {
	createWorkspaceStore,
	type RendererContext,
	type WorkspaceStore,
} from "@superset/panes";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useEffect, useMemo } from "react";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import type { StoreApi } from "zustand/vanilla";
import {
	BrowserPane,
	BrowserPaneToolbar,
	browserRuntimeRegistry,
} from "../$workspaceId/hooks/usePaneRegistry/components/BrowserPane";
import { ChatPane } from "../$workspaceId/hooks/usePaneRegistry/components/ChatPane";
import { CommentPane } from "../$workspaceId/hooks/usePaneRegistry/components/CommentPane";
import { DiffPane } from "../$workspaceId/hooks/usePaneRegistry/components/DiffPane";
import { FilePane } from "../$workspaceId/hooks/usePaneRegistry/components/FilePane";
import { TerminalPane } from "../$workspaceId/hooks/usePaneRegistry/components/TerminalPane";
import type {
	BrowserPaneData,
	ChatPaneData,
	FilePaneData,
	PaneViewerData,
} from "../$workspaceId/types";
import { CanvasHostProvider } from "./CanvasHostProvider";
import type { CanvasStore, CanvasWindow } from "./canvasStore";
import {
	type CanvasSearchData,
	type CanvasSettingsData,
	canvasWindowIds,
	openCanvasWindow,
} from "./openCanvasWindow";
import { CanvasSearchPane } from "./panes/CanvasSearchPane";
import { CanvasSettingsPane } from "./panes/CanvasSettingsPane";
import { SubagentPane } from "./SubagentPane";
import {
	type CanvasSubagentData,
	type CanvasTerminalData,
	writeBrowserPaneDataToWorkspace,
} from "./useCanvasSeeding";

// TerminalPane's URL-click "open in pane" path writes into ctx.store. The
// canvas has no tab layout, so those opens land in this inert store and are
// dropped; external opens still work.
let sinkStore: StoreApi<WorkspaceStore<PaneViewerData>> | null = null;
function getSinkStore(): StoreApi<WorkspaceStore<PaneViewerData>> {
	sinkStore ??= createWorkspaceStore<PaneViewerData>({
		initialState: { version: 1, tabs: [], activeTabId: null },
	});
	return sinkStore;
}

const NullPaneHeaderActions = () => null;

function noop() {}

/**
 * Adapt a canvas window to the panes RendererContext so TerminalPane /
 * BrowserPane render unmodified. The window id doubles as the xterm
 * instanceId and the webview paneId, so both runtime registries key
 * canvas instances independently of tabs-mode ones (terminals) or share
 * them (mirrored browser panes).
 */
function useCanvasRendererContext({
	window,
	isFocused,
	store,
}: {
	window: CanvasWindow;
	isFocused: boolean;
	store: StoreApi<CanvasStore>;
}): RendererContext<PaneViewerData> {
	const collections = useCollections();
	return useMemo<RendererContext<PaneViewerData>>(() => {
		const pane = {
			id: window.id,
			kind: window.kind,
			data: window.data as PaneViewerData,
			parentDirection: null,
		};
		return {
			pane,
			tab: {
				id: `canvas:${window.id}`,
				position: 0,
				createdAt: 0,
				activePaneId: isFocused ? window.id : null,
				layout: { type: "pane", paneId: window.id },
				panes: { [window.id]: pane },
			},
			isActive: isFocused,
			store: getSinkStore(),
			actions: {
				close: () => {
					const current = store.getState().windows[window.id];
					if (!current) return;
					if (current.kind === "terminal") {
						const { terminalId } = current.data as CanvasTerminalData;
						terminalRuntimeRegistry.release(terminalId, window.id);
					}
					store.getState().removeWindows([window.id], { dismiss: true });
				},
				focus: () => {
					store.getState().bringToFront(window.id);
					store.getState().setFocusedWindow(window.id);
				},
				setTitle: noop,
				pin: noop,
				updateData: (data) => {
					store.getState().updateWindowData(window.id, data);
					// Keep the mirrored source pane in sync so tabs mode shows the
					// same page after canvas navigation.
					if (window.kind === "browser" && !window.ephemeral) {
						writeBrowserPaneDataToWorkspace(
							collections,
							window.workspaceId,
							window.id,
							data as BrowserPaneData,
						);
					}
				},
				// Webview popups (window.open, "open in split") become sibling
				// canvas-only windows.
				split: (_position, newPane) => {
					if (newPane.kind !== "browser") return;
					const source = store.getState().windows[window.id];
					if (!source) return;
					const id = crypto.randomUUID();
					store.getState().upsertWindows([
						{
							id,
							kind: "browser",
							workspaceId: source.workspaceId,
							x: source.x + 48,
							y: source.y + 48,
							width: source.width,
							height: source.height,
							data: newPane.data as BrowserPaneData as unknown,
							ephemeral: true,
						},
					]);
					store.getState().bringToFront(id);
					store.getState().setFocusedWindow(id);
				},
			},
			components: { PaneHeaderActions: NullPaneHeaderActions },
		};
	}, [window, isFocused, store, collections]);
}

function openCanvasFileWindow(
	store: StoreApi<CanvasStore>,
	workspaceId: string,
	absolutePath: string,
): void {
	openCanvasWindow(store, {
		id: canvasWindowIds.file(workspaceId, absolutePath),
		kind: "file",
		workspaceId,
		data: { filePath: absolutePath, mode: "editor" } satisfies FilePaneData,
	});
}

/**
 * DiffPane's in-diff "open file" links resolve worktree-relative paths, so
 * this lives inside the window's CanvasHostProvider where the owning host's
 * workspace.get is reachable.
 */
function CanvasDiffContent({
	ctx,
	window,
	store,
}: {
	ctx: RendererContext<PaneViewerData>;
	window: CanvasWindow;
	store: StoreApi<CanvasStore>;
}) {
	const workspaceQuery = workspaceTrpc.workspace.get.useQuery({
		id: window.workspaceId,
	});
	const worktreePath = workspaceQuery.data?.worktreePath ?? "";
	const handleOpenFile = useCallback(
		(filePath: string) => {
			const absolutePath = worktreePath
				? toAbsoluteWorkspacePath(worktreePath, filePath)
				: filePath;
			openCanvasFileWindow(store, window.workspaceId, absolutePath);
		},
		[worktreePath, store, window.workspaceId],
	);
	return (
		<DiffPane
			context={ctx}
			workspaceId={window.workspaceId}
			onOpenFile={handleOpenFile}
		/>
	);
}

export function CanvasWindowContent({
	window,
	isFocused,
	store,
	hostId,
	organizationId,
}: {
	window: CanvasWindow;
	isFocused: boolean;
	store: StoreApi<CanvasStore>;
	/** Owning workspace's host, null when unknown (falls back to local). */
	hostId: string | null;
	organizationId: string;
}) {
	const ctx = useCanvasRendererContext({ window, isFocused, store });

	// Ephemeral browser windows (webview popups, "open in split") are canvas-only
	// and mirrored nowhere, so their webview must be torn down when the window
	// leaves the canvas — on dismiss and on canvas exit alike. Mirrored panes are
	// shared with tabs mode; BrowserPane only detaches those.
	useEffect(() => {
		if (window.kind !== "browser" || !window.ephemeral) return;
		const paneId = window.id;
		return () => {
			browserRuntimeRegistry.destroy(paneId);
		};
	}, [window.kind, window.ephemeral, window.id]);

	// A browser window mounting here may be a culled webview scrolling back
	// into view — that reveal happens on the same gesture end whose zoom pass
	// ran before this mount committed, so reapply the canvas zoom now.
	useEffect(() => {
		if (window.kind !== "browser") return;
		browserRuntimeRegistry.setContentZoom(
			window.id,
			store.getState().camera.zoom,
		);
	}, [window.kind, window.id, store]);

	// Same for terminals: a runtime mounting here (fresh window, or culled →
	// live revival) rasterized at 1×, and the gesture-end render-zoom pass in
	// CanvasView ran before this mount committed. TerminalPane's mount effect
	// runs first (child before parent), so the runtime exists by now.
	useEffect(() => {
		if (window.kind !== "terminal") return;
		const { terminalId } = window.data as CanvasTerminalData;
		terminalRuntimeRegistry.setRenderZoom(
			terminalId,
			store.getState().camera.zoom,
			window.id,
		);
	}, [window.kind, window.id, window.data, store]);

	const updateWindowData = useCallback(
		(data: unknown) => store.getState().updateWindowData(window.id, data),
		[store, window.id],
	);

	if (window.kind === "subagent") {
		return (
			<CanvasHostProvider hostId={hostId} organizationId={organizationId}>
				<SubagentPane data={window.data as CanvasSubagentData} />
			</CanvasHostProvider>
		);
	}

	if (window.kind === "terminal") {
		return (
			<CanvasHostProvider hostId={hostId} organizationId={organizationId}>
				<TerminalPane
					ctx={ctx}
					workspaceId={window.workspaceId}
					onOpenFile={noop}
					onRevealPath={noop}
				/>
			</CanvasHostProvider>
		);
	}

	if (window.kind === "file") {
		return (
			<CanvasHostProvider hostId={hostId} organizationId={organizationId}>
				<FilePane context={ctx} workspaceId={window.workspaceId} />
			</CanvasHostProvider>
		);
	}

	if (window.kind === "diff") {
		return (
			<CanvasHostProvider hostId={hostId} organizationId={organizationId}>
				<CanvasDiffContent ctx={ctx} window={window} store={store} />
			</CanvasHostProvider>
		);
	}

	if (window.kind === "comment") {
		return <CommentPane context={ctx} />;
	}

	if (window.kind === "chat") {
		const data = window.data as ChatPaneData;
		return (
			<CanvasHostProvider hostId={hostId} organizationId={organizationId}>
				<ChatPane
					workspaceId={window.workspaceId}
					sessionId={data.sessionId}
					onSessionIdChange={(sessionId) =>
						updateWindowData({ ...data, sessionId })
					}
					initialLaunchConfig={data.launchConfig ?? null}
					onConsumeLaunchConfig={() =>
						updateWindowData({ ...data, launchConfig: null })
					}
				/>
			</CanvasHostProvider>
		);
	}

	if (window.kind === "search") {
		return (
			<CanvasHostProvider hostId={hostId} organizationId={organizationId}>
				<CanvasSearchPane
					workspaceId={window.workspaceId}
					data={window.data as CanvasSearchData}
					onDataChange={updateWindowData}
					onSelectFile={(absolutePath) =>
						openCanvasFileWindow(store, window.workspaceId, absolutePath)
					}
				/>
			</CanvasHostProvider>
		);
	}

	if (window.kind === "settings") {
		return (
			<CanvasSettingsPane
				data={window.data as CanvasSettingsData}
				onDataChange={updateWindowData}
			/>
		);
	}

	return (
		<div className="flex h-full w-full flex-col">
			<div className="flex h-8 shrink-0 items-center border-b border-border/50 px-1">
				<BrowserPaneToolbar ctx={ctx} />
			</div>
			<div className="min-h-0 flex-1">
				<BrowserPane ctx={ctx} />
			</div>
		</div>
	);
}
