import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo, useRef } from "react";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { PaneViewerData } from "../../types";

const EMPTY_STATE: WorkspaceState<PaneViewerData> = {
	version: 1,
	tabs: [],
	activeTabId: null,
};
const PANE_LAYOUT_PERSIST_DEBOUNCE_MS = 1_000;

function getSnapshot(state: WorkspaceState<PaneViewerData>): string {
	return JSON.stringify(state);
}

export function useV2WorkspacePaneLayout() {
	const { workspace } = useWorkspace();
	const workspaceId = workspace.id;
	const collections = useCollections();
	// Keep the volatile pane store scoped to the route workspace. During fast
	// workspace switches, live queries can briefly return stale rows; sharing
	// the same store across that boundary lets panes from one worktree render
	// and persist under another.
	const workspaceRuntime = useMemo(
		() => ({
			workspaceId,
			store: createWorkspaceStore<PaneViewerData>({
				initialState: EMPTY_STATE,
			}),
		}),
		[workspaceId],
	);
	const { store } = workspaceRuntime;
	const syncStateRef = useRef({
		workspaceId,
		lastSyncedSnapshot: getSnapshot(EMPTY_STATE),
	});
	const pendingPersistRef = useRef<{
		snapshot: string;
		state: WorkspaceState<PaneViewerData>;
	} | null>(null);
	const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const { data: localWorkspaceRows = [] } = useLiveQuery(
		(query) =>
			query
				.from({ v2WorkspaceLocalState: collections.v2WorkspaceLocalState })
				.where(({ v2WorkspaceLocalState }) =>
					eq(v2WorkspaceLocalState.workspaceId, workspaceId),
				),
		[collections, workspaceId],
	);
	const localWorkspaceState =
		localWorkspaceRows.find((row) => row.workspaceId === workspaceId) ?? null;
	const persistedPaneLayout = useMemo(
		() =>
			localWorkspaceState?.workspaceId === workspaceId
				? ((localWorkspaceState.paneLayout as
						| WorkspaceState<PaneViewerData>
						| undefined) ?? EMPTY_STATE)
				: EMPTY_STATE,
		[localWorkspaceState, workspaceId],
	);

	useEffect(() => {
		syncStateRef.current = {
			workspaceId,
			lastSyncedSnapshot: getSnapshot(EMPTY_STATE),
		};
		pendingPersistRef.current = null;
		if (persistTimerRef.current) {
			clearTimeout(persistTimerRef.current);
			persistTimerRef.current = null;
		}
	}, [workspaceId]);

	useEffect(() => {
		const nextSnapshot = getSnapshot(persistedPaneLayout);
		if (nextSnapshot === syncStateRef.current.lastSyncedSnapshot) {
			return;
		}

		syncStateRef.current.lastSyncedSnapshot = nextSnapshot;
		store.getState().replaceState(persistedPaneLayout);
	}, [persistedPaneLayout, store]);

	useEffect(() => {
		const flushPendingPersist = () => {
			const pending = pendingPersistRef.current;
			pendingPersistRef.current = null;
			persistTimerRef.current = null;
			if (!pending) return;

			if (!collections.v2WorkspaceLocalState.get(workspaceId)) {
				return;
			}

			collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
				draft.paneLayout = pending.state;
			});
			syncStateRef.current.lastSyncedSnapshot = pending.snapshot;
		};

		const unsubscribe = store.subscribe((nextStore) => {
			const nextWorkspaceState: WorkspaceState<PaneViewerData> = {
				version: nextStore.version,
				tabs: nextStore.tabs,
				activeTabId: nextStore.activeTabId,
			};
			const nextSnapshot = getSnapshot(nextWorkspaceState);
			if (nextSnapshot === syncStateRef.current.lastSyncedSnapshot) {
				return;
			}

			if (!collections.v2WorkspaceLocalState.get(workspaceId)) {
				return;
			}

			pendingPersistRef.current = {
				snapshot: nextSnapshot,
				state: nextWorkspaceState,
			};
			if (persistTimerRef.current) {
				clearTimeout(persistTimerRef.current);
			}
			persistTimerRef.current = setTimeout(
				flushPendingPersist,
				PANE_LAYOUT_PERSIST_DEBOUNCE_MS,
			);
		});

		return () => {
			if (persistTimerRef.current) {
				clearTimeout(persistTimerRef.current);
				flushPendingPersist();
			}
			unsubscribe();
		};
	}, [collections, store, workspaceId]);

	return { store };
}
