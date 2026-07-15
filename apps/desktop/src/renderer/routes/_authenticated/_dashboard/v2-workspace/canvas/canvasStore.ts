import type {
	CanvasCamera,
	CanvasWindowRow,
	GlobalCanvasLayoutRow,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import {
	DEFAULT_CANVAS_CAMERA,
	V2_GLOBAL_CANVAS_ID,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { createStore, type StoreApi } from "zustand/vanilla";
import { clampZoom } from "./canvasGeometry";

export type CanvasWindow = CanvasWindowRow;

export interface CanvasWindowGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CanvasStore {
	camera: CanvasCamera;
	windows: Record<string, CanvasWindow>;
	/** Last entry renders topmost. Always holds exactly the window ids. */
	zOrder: string[];
	// --- volatile (not persisted) ---
	focusedWindowId: string | null;
	gestureActive: boolean;
	/** True once the persisted row's first live-query emission has been applied
	 *  (or its absence confirmed). Seeding and persistence wait for this so
	 *  windows seeded before hydration aren't discarded, and the store never
	 *  clobbers a not-yet-hydrated row. */
	hydrated: boolean;
	/** Windows explicitly closed this session — reconciliation skips them so
	 *  a dismissed mirror doesn't immediately reappear. */
	dismissedWindowIds: Set<string>;
	/** Last measured canvas viewport size, for placing new windows in view.
	 *  {0,0} until CanvasView's ResizeObserver reports. */
	viewportSize: { width: number; height: number };

	upsertWindows: (windows: CanvasWindow[]) => void;
	removeWindows: (ids: string[], options?: { dismiss?: boolean }) => void;
	updateWindowData: (id: string, data: unknown) => void;
	setWindowGeometry: (id: string, geometry: CanvasWindowGeometry) => void;
	bringToFront: (id: string) => void;
	setFocusedWindow: (id: string | null) => void;
	setCamera: (camera: CanvasCamera) => void;
	setGestureActive: (active: boolean) => void;
	setViewportSize: (size: { width: number; height: number }) => void;
	setHydrated: () => void;
	replaceState: (row: GlobalCanvasLayoutRow) => void;
	toPersistedRow: () => GlobalCanvasLayoutRow;
}

function normalizedZOrder(
	zOrder: string[],
	windows: Record<string, CanvasWindow>,
): string[] {
	const seen = new Set<string>();
	const next = zOrder.filter((id) => {
		if (seen.has(id) || !windows[id]) return false;
		seen.add(id);
		return true;
	});
	for (const id of Object.keys(windows)) {
		if (!seen.has(id)) next.push(id);
	}
	return next;
}

export function createCanvasStore(): StoreApi<CanvasStore> {
	return createStore<CanvasStore>()((set, get) => ({
		camera: DEFAULT_CANVAS_CAMERA,
		windows: {},
		zOrder: [],
		focusedWindowId: null,
		gestureActive: false,
		hydrated: false,
		dismissedWindowIds: new Set(),
		viewportSize: { width: 0, height: 0 },

		upsertWindows: (incoming) => {
			if (incoming.length === 0) return;
			set((state) => {
				const windows = { ...state.windows };
				for (const window of incoming) {
					const existing = windows[window.id];
					// Preserve user-adjusted geometry on re-seed; refresh data only.
					windows[window.id] = existing
						? { ...existing, data: window.data }
						: window;
				}
				return { windows, zOrder: normalizedZOrder(state.zOrder, windows) };
			});
		},

		removeWindows: (ids, options) => {
			if (ids.length === 0) return;
			set((state) => {
				const removed = new Set(ids);
				const windows = { ...state.windows };
				for (const id of ids) delete windows[id];
				const dismissedWindowIds = options?.dismiss
					? new Set([...state.dismissedWindowIds, ...ids])
					: state.dismissedWindowIds;
				return {
					windows,
					zOrder: state.zOrder.filter((id) => !removed.has(id)),
					focusedWindowId:
						state.focusedWindowId && removed.has(state.focusedWindowId)
							? null
							: state.focusedWindowId,
					dismissedWindowIds,
				};
			});
		},

		updateWindowData: (id, data) => {
			set((state) => {
				const window = state.windows[id];
				if (!window) return state;
				return { windows: { ...state.windows, [id]: { ...window, data } } };
			});
		},

		setWindowGeometry: (id, geometry) => {
			set((state) => {
				const window = state.windows[id];
				if (!window) return state;
				return {
					windows: { ...state.windows, [id]: { ...window, ...geometry } },
				};
			});
		},

		bringToFront: (id) => {
			set((state) => {
				if (!state.windows[id]) return state;
				if (state.zOrder[state.zOrder.length - 1] === id) return state;
				return {
					zOrder: [...state.zOrder.filter((other) => other !== id), id],
				};
			});
		},

		setFocusedWindow: (id) => {
			set((state) =>
				state.focusedWindowId === id ? state : { focusedWindowId: id },
			);
		},

		setCamera: (camera) => {
			set({ camera: { ...camera, zoom: clampZoom(camera.zoom) } });
		},

		setGestureActive: (active) => {
			set((state) =>
				state.gestureActive === active ? state : { gestureActive: active },
			);
		},

		setViewportSize: (size) => {
			set((state) =>
				state.viewportSize.width === size.width &&
				state.viewportSize.height === size.height
					? state
					: { viewportSize: size },
			);
		},

		setHydrated: () => {
			set((state) => (state.hydrated ? state : { hydrated: true }));
		},

		replaceState: (row) => {
			const windows: Record<string, CanvasWindow> = {};
			for (const window of row.windows) windows[window.id] = window;
			set({
				camera: { ...row.camera, zoom: clampZoom(row.camera.zoom) },
				windows,
				zOrder: normalizedZOrder(row.zOrder, windows),
			});
		},

		toPersistedRow: () => {
			const state = get();
			return {
				id: V2_GLOBAL_CANVAS_ID,
				version: 1,
				camera: state.camera,
				// zOrder doubles as the stable serialization order.
				windows: state.zOrder
					.map((id) => state.windows[id])
					.filter((window): window is CanvasWindow => Boolean(window)),
				zOrder: state.zOrder,
			};
		},
	}));
}

// One canvas per organization, cached at module level so switching workspace
// routes (which remounts the canvas view) keeps camera/windows state. HMR
// preservation matches the terminal/browser registries.
const canvasStoreCache: Map<string, StoreApi<CanvasStore>> = (import.meta.hot
	?.data?.canvasStores as Map<string, StoreApi<CanvasStore>> | undefined) ??
new Map();

if (import.meta.hot) {
	import.meta.hot.data.canvasStores = canvasStoreCache;
}

export function getGlobalCanvasStore(
	organizationId: string,
): StoreApi<CanvasStore> {
	let store = canvasStoreCache.get(organizationId);
	if (!store) {
		store = createCanvasStore();
		canvasStoreCache.set(organizationId, store);
	}
	return store;
}
