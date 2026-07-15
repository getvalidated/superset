import type { WorkspaceState } from "@superset/panes";
import { workspaceTrpc } from "@superset/workspace-client";
import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo } from "react";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { AppCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { BrowserPaneData, TerminalPaneData } from "../$workspaceId/types";
import { CanvasHostProvider } from "./CanvasHostProvider";
import { planWindowPlacements } from "./canvasGeometry";
import type { CanvasStore, CanvasWindow } from "./canvasStore";

export const TERMINAL_WINDOW_ID_PREFIX = "term:";

export function terminalWindowId(terminalId: string): string {
	return `${TERMINAL_WINDOW_ID_PREFIX}${terminalId}`;
}

/** Extra fields the canvas keeps alongside TerminalPaneData. */
export interface CanvasTerminalData extends TerminalPaneData {
	/** Last known session title, for placeholder cards. */
	title?: string | null;
}

interface SessionSummary {
	terminalId: string;
	workspaceId: string;
	exited: boolean;
	title: string | null;
}

/**
 * Diff one host's live sessions against the canvas windows owned by that
 * host and add/remove terminal windows accordingly. Scope is the union of
 * the host's known workspace ids and the workspace ids the sessions claim,
 * so a session whose workspace row is gone still shows (and prunes) here.
 */
export function reconcileTerminalWindows({
	store,
	hostWorkspaceIds,
	sessions,
}: {
	store: StoreApi<CanvasStore>;
	hostWorkspaceIds: readonly string[];
	sessions: readonly SessionSummary[];
}): void {
	const state = store.getState();
	const live = new Map<string, SessionSummary>();
	const scope = new Set(hostWorkspaceIds);
	for (const session of sessions) {
		// A dead session still puts its workspace in scope, so its orphaned
		// window is reconciled (and pruned below) even if the workspace row is
		// already gone — only live sessions keep their window.
		scope.add(session.workspaceId);
		if (session.exited) continue;
		live.set(session.terminalId, session);
	}

	const toRemove: string[] = [];
	for (const window of Object.values(state.windows)) {
		if (window.kind !== "terminal" || !scope.has(window.workspaceId)) continue;
		const { terminalId } = window.data as CanvasTerminalData;
		if (!live.has(terminalId)) toRemove.push(window.id);
	}

	const toAdd: SessionSummary[] = [];
	const toRefresh: CanvasWindow[] = [];
	for (const session of live.values()) {
		const id = terminalWindowId(session.terminalId);
		if (state.dismissedWindowIds.has(id)) continue;
		const existing = state.windows[id];
		if (!existing) {
			toAdd.push(session);
			continue;
		}
		const data = existing.data as CanvasTerminalData;
		if (data.title !== session.title) {
			toRefresh.push({
				...existing,
				data: { ...data, title: session.title },
			});
		}
	}

	if (toRemove.length > 0) {
		for (const windowId of toRemove) {
			const window = state.windows[windowId];
			if (!window) continue;
			const { terminalId } = window.data as CanvasTerminalData;
			// Renderer-side release only — the session is already dead host-side.
			terminalRuntimeRegistry.release(terminalId, windowId);
		}
		state.removeWindows(toRemove);
	}

	if (toAdd.length > 0) {
		// Group new windows by workspace so a workspace's sessions land adjacent.
		toAdd.sort(
			(a, b) =>
				a.workspaceId.localeCompare(b.workspaceId) ||
				a.terminalId.localeCompare(b.terminalId),
		);
		const placements = planWindowPlacements({
			existing: Object.values(store.getState().windows),
			toPlaceCount: toAdd.length,
		});
		state.upsertWindows(
			toAdd.map((session, index) => ({
				id: terminalWindowId(session.terminalId),
				kind: "terminal" as const,
				workspaceId: session.workspaceId,
				...placements[index],
				data: {
					terminalId: session.terminalId,
					title: session.title,
				} satisfies CanvasTerminalData,
			})),
		);
	}

	if (toRefresh.length > 0) state.upsertWindows(toRefresh);
}

function HostSessionsSync({
	hostWorkspaceIds,
	store,
}: {
	hostWorkspaceIds: readonly string[];
	store: StoreApi<CanvasStore>;
}) {
	// Older remote host-services may not expose listAllSessions yet; the
	// query then errors and this host simply contributes no windows.
	const sessionsQuery = workspaceTrpc.terminal.listAllSessions.useQuery(
		undefined,
		{
			refetchInterval: 15_000,
			refetchOnWindowFocus: true,
			retry: 1,
		},
	);
	const hydrated = useStore(store, (state) => state.hydrated);

	useEffect(() => {
		// Wait for the persisted row to hydrate so seeded windows aren't
		// discarded by a late initial replaceState.
		if (!hydrated) return;
		if (!sessionsQuery.data) return;
		reconcileTerminalWindows({
			store,
			hostWorkspaceIds,
			sessions: sessionsQuery.data.sessions,
		});
	}, [sessionsQuery.data, hostWorkspaceIds, store, hydrated]);

	return null;
}

/**
 * Render-nothing fan-out: one workspace-client per distinct host, each
 * syncing that host's live sessions into the canvas store.
 */
export function CanvasSessionSeeder({
	store,
}: {
	store: StoreApi<CanvasStore>;
}) {
	const { workspaces } = useHostWorkspaces();

	const hostGroups = useMemo(() => {
		const groups = new Map<
			string,
			{ hostId: string; organizationId: string; workspaceIds: string[] }
		>();
		for (const workspace of workspaces) {
			const group = groups.get(workspace.hostId) ?? {
				hostId: workspace.hostId,
				organizationId: workspace.organizationId,
				workspaceIds: [],
			};
			group.workspaceIds.push(workspace.id);
			groups.set(workspace.hostId, group);
		}
		return Array.from(groups.values());
	}, [workspaces]);

	return (
		<>
			{hostGroups.map((group) => (
				<CanvasHostProvider
					key={group.hostId}
					hostId={group.hostId}
					organizationId={group.organizationId}
				>
					<HostSessionsSync
						hostWorkspaceIds={group.workspaceIds}
						store={store}
					/>
				</CanvasHostProvider>
			))}
		</>
	);
}

interface MirroredBrowserPane {
	paneId: string;
	workspaceId: string;
	data: BrowserPaneData;
}

export function collectBrowserPanes(
	rows: Array<{ workspaceId: string; paneLayout: unknown }>,
): MirroredBrowserPane[] {
	const panes: MirroredBrowserPane[] = [];
	for (const row of rows) {
		const layout = row.paneLayout as WorkspaceState<unknown> | undefined;
		if (!layout || !Array.isArray(layout.tabs)) continue;
		for (const tab of layout.tabs) {
			for (const pane of Object.values(tab.panes)) {
				if (pane.kind !== "browser") continue;
				panes.push({
					paneId: pane.id,
					workspaceId: row.workspaceId,
					data: (pane.data ?? { url: "" }) as BrowserPaneData,
				});
			}
		}
	}
	return panes;
}

/**
 * Mirror every workspace's browser panes onto the canvas. Window id = the
 * real pane id, so an already-live webview (created in tabs mode) reattaches
 * to the canvas placeholder. Ephemeral windows (webview popups spawned on
 * the canvas) are canvas-owned and never pruned here.
 */
export function useCanvasBrowserMirror(store: StoreApi<CanvasStore>): void {
	const collections = useCollections();
	const { data: localRows = [] } = useLiveQuery(
		(query) =>
			query.from({
				workspaceLocalState: collections.v2WorkspaceLocalState,
			}),
		[collections],
	);
	const hydrated = useStore(store, (state) => state.hydrated);

	useEffect(() => {
		// Wait for the persisted row to hydrate so mirrored windows aren't
		// discarded by a late initial replaceState.
		if (!hydrated) return;
		const panes = collectBrowserPanes(localRows);
		const state = store.getState();
		const liveIds = new Set(panes.map((pane) => pane.paneId));

		const toRemove = Object.values(state.windows)
			.filter(
				(window) =>
					window.kind === "browser" &&
					!window.ephemeral &&
					!liveIds.has(window.id),
			)
			.map((window) => window.id);
		if (toRemove.length > 0) state.removeWindows(toRemove);

		const toAdd = panes.filter(
			(pane) =>
				!store.getState().windows[pane.paneId] &&
				!state.dismissedWindowIds.has(pane.paneId),
		);
		const toRefresh = panes.filter((pane) => {
			const existing = store.getState().windows[pane.paneId];
			if (!existing) return false;
			return JSON.stringify(existing.data) !== JSON.stringify(pane.data);
		});

		if (toAdd.length > 0) {
			const placements = planWindowPlacements({
				existing: Object.values(store.getState().windows),
				toPlaceCount: toAdd.length,
			});
			store.getState().upsertWindows(
				toAdd.map((pane, index) => ({
					id: pane.paneId,
					kind: "browser" as const,
					workspaceId: pane.workspaceId,
					...placements[index],
					data: pane.data,
				})),
			);
		}
		if (toRefresh.length > 0) {
			store.getState().upsertWindows(
				toRefresh.map((pane) => {
					const existing = store.getState().windows[pane.paneId];
					return { ...existing, data: pane.data } as CanvasWindow;
				}),
			);
		}
	}, [localRows, store, hydrated]);
}

/**
 * Write a canvas browser window's navigation state back to the pane it
 * mirrors, so tabs mode shows the same page afterwards. Rebuilds the layout
 * immutably — nested draft mutation isn't reliably tracked by the
 * localStorage collection.
 */
export function writeBrowserPaneDataToWorkspace(
	collections: AppCollections,
	workspaceId: string,
	paneId: string,
	data: BrowserPaneData,
): void {
	if (!collections.v2WorkspaceLocalState.get(workspaceId)) return;
	collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
		const layout = draft.paneLayout as WorkspaceState<unknown>;
		if (!layout || !Array.isArray(layout.tabs)) return;
		draft.paneLayout = {
			...layout,
			tabs: layout.tabs.map((tab) =>
				tab.panes[paneId]
					? {
							...tab,
							panes: {
								...tab.panes,
								[paneId]: { ...tab.panes[paneId], data },
							},
						}
					: tab,
			),
		};
	});
}
