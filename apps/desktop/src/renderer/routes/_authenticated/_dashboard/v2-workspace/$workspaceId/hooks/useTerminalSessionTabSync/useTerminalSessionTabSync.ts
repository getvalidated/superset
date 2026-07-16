import type { WorkspaceState, WorkspaceStore } from "@superset/panes";
import { workspaceTrpc } from "@superset/workspace-client";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useEffect } from "react";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData, TerminalPaneData } from "../../types";
import { releaseBackgroundTerminals } from "../../utils/backgroundTerminals";
import {
	collectAttachedTerminalIds,
	getAdoptableSessions,
} from "./getAdoptableSessions";

const SESSION_TAB_SYNC_REFETCH_INTERVAL_MS = 15_000;

/**
 * Keep the tab layout one-to-one with the host's live terminal sessions,
 * mirroring the canvas session seeder: any running session with no pane —
 * e.g. created out-of-band via MCP/host-service `workspaces.create` — gets a
 * (non-focused) tab. Sessions the user deliberately backgrounded are skipped
 * via the persisted `backgroundTerminalIds` set, which is also pruned here
 * once those sessions die. Closing an adopted tab kills the session (regular
 * pane-close semantics), so nothing closed reappears.
 */
export function useTerminalSessionTabSync({
	workspaceId,
	store,
}: {
	workspaceId: string;
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}): void {
	const collections = useCollections();
	const { data: localRows = [] } = useLiveQuery(
		(query) =>
			query
				.from({ v2WorkspaceLocalState: collections.v2WorkspaceLocalState })
				.where(({ v2WorkspaceLocalState }) =>
					eq(v2WorkspaceLocalState.workspaceId, workspaceId),
				),
		[collections, workspaceId],
	);
	const localState =
		localRows.find((row) => row.workspaceId === workspaceId) ?? null;

	// Older remote host-services may not expose listSessions; the query then
	// errors and this workspace simply adopts nothing.
	const sessionsQuery = workspaceTrpc.terminal.listSessions.useQuery(
		{ workspaceId },
		{
			refetchInterval: SESSION_TAB_SYNC_REFETCH_INTERVAL_MS,
			refetchOnWindowFocus: true,
			retry: 1,
		},
	);
	const sessions = sessionsQuery.data?.sessions;

	useEffect(() => {
		// Wait for the local-state row so adopted tabs persist (layout writes
		// are dropped while the row is missing) and the background set is known.
		if (!sessions || !localState) return;

		// Union of the live store and the persisted layout: on first render the
		// persisted layout may not have been replayed into the store yet, and
		// seeding from only one side would double-adopt.
		const attached = collectAttachedTerminalIds(store.getState().tabs);
		const persistedLayout = localState.paneLayout as
			| WorkspaceState<PaneViewerData>
			| undefined;
		if (Array.isArray(persistedLayout?.tabs)) {
			collectAttachedTerminalIds(persistedLayout.tabs, attached);
		}

		const backgroundTerminalIds = localState.backgroundTerminalIds ?? [];
		const adoptable = getAdoptableSessions({
			sessions,
			attachedTerminalIds: attached,
			backgroundTerminalIds,
		});
		for (const session of adoptable) {
			store.getState().addTab({
				activate: false,
				panes: [
					{
						kind: "terminal",
						data: {
							terminalId: session.terminalId,
						} satisfies TerminalPaneData,
					},
				],
			});
		}

		const liveIds = new Set(
			sessions
				.filter((session) => !session.exited)
				.map((session) => session.terminalId),
		);
		releaseBackgroundTerminals(
			collections,
			workspaceId,
			backgroundTerminalIds.filter((id) => !liveIds.has(id)),
		);
	}, [sessions, localState, store, collections, workspaceId]);
}
