import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useRef } from "react";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import {
	type GlobalCanvasLayoutRow,
	V2_GLOBAL_CANVAS_ID,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import type { StoreApi } from "zustand/vanilla";
import type { CanvasStore } from "./canvasStore";

const WRITE_DEBOUNCE_MS = 300;

function getSnapshot(row: GlobalCanvasLayoutRow): string {
	return JSON.stringify(row);
}

/**
 * Bidirectional sync between the volatile canvas store and the persisted
 * v2GlobalCanvas singleton row (snapshot-diff pattern, cf.
 * useV2WorkspacePaneLayout). Writes are debounced and suppressed while a
 * pan/zoom/drag gesture is active — persisting settled state only.
 */
export function useGlobalCanvasLayout(store: StoreApi<CanvasStore>): void {
	const collections = useCollections();
	const lastSyncedSnapshotRef = useRef<string | null>(null);
	const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const { data: rows = [], isReady } = useLiveQuery(
		(query) =>
			query
				.from({ canvas: collections.v2GlobalCanvas })
				.where(({ canvas }) => eq(canvas.id, V2_GLOBAL_CANVAS_ID)),
		[collections],
	);
	const persistedRow = rows[0] ?? null;

	// Row → store. Wait for strict readiness before touching the store: the
	// first ready emission hydrates it (adopting the persisted row, or
	// confirming none exists) and unblocks seeding; later emissions are
	// external changes replayed only when the snapshot diverges.
	useEffect(() => {
		if (!isReady) return;
		const state = store.getState();
		if (persistedRow) {
			const nextSnapshot = getSnapshot(persistedRow);
			if (nextSnapshot !== lastSyncedSnapshotRef.current) {
				lastSyncedSnapshotRef.current = nextSnapshot;
				state.replaceState(persistedRow);
			}
		}
		if (!state.hydrated) state.setHydrated();
	}, [persistedRow, isReady, store]);

	// Store → row, debounced, gesture-gated.
	useEffect(() => {
		const flush = () => {
			const state = store.getState();
			if (!state.hydrated) return;
			if (state.gestureActive) return;
			const nextRow = state.toPersistedRow();
			const nextSnapshot = getSnapshot(nextRow);
			if (nextSnapshot === lastSyncedSnapshotRef.current) return;
			lastSyncedSnapshotRef.current = nextSnapshot;
			if (collections.v2GlobalCanvas.get(V2_GLOBAL_CANVAS_ID)) {
				collections.v2GlobalCanvas.update(V2_GLOBAL_CANVAS_ID, (draft) => {
					draft.camera = nextRow.camera;
					draft.windows = nextRow.windows;
					draft.zOrder = nextRow.zOrder;
				});
			} else {
				collections.v2GlobalCanvas.insert(nextRow);
			}
		};

		const unsubscribe = store.subscribe((state, prevState) => {
			// Volatile-only updates (focus, gesture flag flips to true) don't
			// need a write; a gesture ending must flush the settled state.
			const persistedChanged =
				state.camera !== prevState.camera ||
				state.windows !== prevState.windows ||
				state.zOrder !== prevState.zOrder;
			const gestureEnded = prevState.gestureActive && !state.gestureActive;
			if (!persistedChanged && !gestureEnded) return;
			if (state.gestureActive) return;
			if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
			writeTimerRef.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
		});

		return () => {
			unsubscribe();
			if (writeTimerRef.current) {
				clearTimeout(writeTimerRef.current);
				writeTimerRef.current = null;
			}
			// Persist whatever settled state is pending on unmount (mode exit).
			flush();
		};
	}, [collections, store]);
}
