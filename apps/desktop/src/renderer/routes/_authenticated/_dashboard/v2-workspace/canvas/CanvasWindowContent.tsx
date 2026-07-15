import {
	createWorkspaceStore,
	type RendererContext,
	type WorkspaceStore,
} from "@superset/panes";
import { useEffect, useMemo } from "react";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { StoreApi } from "zustand/vanilla";
import {
	BrowserPane,
	BrowserPaneToolbar,
	browserRuntimeRegistry,
} from "../$workspaceId/hooks/usePaneRegistry/components/BrowserPane";
import { TerminalPane } from "../$workspaceId/hooks/usePaneRegistry/components/TerminalPane";
import type { BrowserPaneData, PaneViewerData } from "../$workspaceId/types";
import { CanvasHostProvider } from "./CanvasHostProvider";
import type { CanvasStore, CanvasWindow } from "./canvasStore";
import {
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
