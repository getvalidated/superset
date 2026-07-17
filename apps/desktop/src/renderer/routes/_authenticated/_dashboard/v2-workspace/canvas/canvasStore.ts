import type {
	CanvasCamera,
	CanvasShapeRow,
	CanvasWindowRow,
	GlobalCanvasLayoutRow,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import {
	DEFAULT_CANVAS_CAMERA,
	V2_GLOBAL_CANVAS_ID,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { createStore, type StoreApi } from "zustand/vanilla";
import { type CanvasRect, clampZoom } from "./canvasGeometry";
import {
	DEFAULT_CANVAS_TEXT_SIZE_PX,
	resolveCanvasShapeColor,
} from "./canvasShapeStyle";

export type CanvasWindow = CanvasWindowRow;
export type CanvasShape = CanvasShapeRow;

export type CanvasTool = "select" | "line" | "box" | "text";

/** Styling applied to the next drawn shape, edited via the toolbar's second
 *  row while a drawing tool is armed. `color` is a palette key from
 *  CANVAS_SHAPE_COLORS; per-kind fields are ignored by the other tools. */
export interface CanvasDrawStyle {
	color: string;
	/** Box tool: fill the rect with a tint of the stroke color. */
	fill: boolean;
	/** Text tool: font size in px. */
	fontSize: number;
	bold: boolean;
	italic: boolean;
}

export const DEFAULT_CANVAS_DRAW_STYLE: CanvasDrawStyle = {
	color: "default",
	fill: false,
	fontSize: DEFAULT_CANVAS_TEXT_SIZE_PX,
	bold: false,
	italic: false,
};

/** How a background left-drag behaves: "drag" pans the camera (hand tool),
 *  "select" draws a marquee (Figma-style pointer). */
export type CanvasInteractionMode = "drag" | "select";

export interface CanvasWindowGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The user-editable document portion of the store — what undo/redo restores. */
interface CanvasHistorySnapshot {
	windows: Record<string, CanvasWindow>;
	zOrder: string[];
	shapes: Record<string, CanvasShape>;
	shapeOrder: string[];
	dismissedWindowIds: Set<string>;
}

const MAX_HISTORY_ENTRIES = 100;

export interface CanvasStore {
	camera: CanvasCamera;
	windows: Record<string, CanvasWindow>;
	/** Last entry renders topmost. Always holds exactly the window ids. */
	zOrder: string[];
	/** Drawn annotations (lines/boxes/text), keyed by id. */
	shapes: Record<string, CanvasShape>;
	/** Render + serialization order. Always holds exactly the shape ids. */
	shapeOrder: string[];
	// --- volatile (not persisted) ---
	focusedWindowId: string | null;
	/** Multi-select for group move/delete. Windows and shapes select together. */
	selectedWindowIds: ReadonlySet<string>;
	selectedShapeIds: ReadonlySet<string>;
	/** Active toolbar tool; non-select tools arm the drawing overlay. */
	activeTool: CanvasTool;
	/** Styling for the next drawn shape. Tool state, not document state — it
	 *  is neither persisted nor part of undo history. */
	drawStyle: CanvasDrawStyle;
	/** Drag (pan) vs select (marquee) behavior for background drags. */
	interactionMode: CanvasInteractionMode;
	/** Text shape currently being edited in place. */
	editingShapeId: string | null;
	/** Shift-drag selection rectangle in viewport (screen) coordinates. */
	marquee: CanvasRect | null;
	undoStack: CanvasHistorySnapshot[];
	redoStack: CanvasHistorySnapshot[];
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
	upsertShapes: (shapes: CanvasShape[]) => void;
	removeShapes: (ids: string[]) => void;
	setShapeText: (id: string, text: string) => void;
	/** Restyle already-drawn shapes. Fields inapplicable to a shape's type are
	 *  ignored, and default values clear the persisted field so restyled-back
	 *  shapes stay byte-identical to never-styled rows. Locked shapes are
	 *  skipped. Callers push history first. */
	setShapesStyle: (ids: string[], style: Partial<CanvasDrawStyle>) => void;
	/** Move the given windows and shapes by a canvas-coordinate delta. */
	translateItems: (
		windowIds: string[],
		shapeIds: string[],
		dx: number,
		dy: number,
	) => void;
	/** Lock or unlock windows/shapes. Locked items ignore move/resize and
	 *  drop out of (and can't rejoin) the selection until unlocked. */
	setItemsLocked: (
		windowIds: string[],
		shapeIds: string[],
		locked: boolean,
	) => void;
	setSelection: (
		windowIds: Iterable<string>,
		shapeIds: Iterable<string>,
	) => void;
	toggleWindowSelection: (id: string) => void;
	toggleShapeSelection: (id: string) => void;
	clearSelection: () => void;
	setActiveTool: (tool: CanvasTool) => void;
	setDrawStyle: (style: Partial<CanvasDrawStyle>) => void;
	setInteractionMode: (mode: CanvasInteractionMode) => void;
	setEditingShape: (id: string | null) => void;
	setMarquee: (rect: CanvasRect | null) => void;
	/** Snapshot the document before a user mutation so ⌘Z can restore it. */
	pushHistory: () => void;
	undo: () => void;
	redo: () => void;
	setCamera: (camera: CanvasCamera) => void;
	setGestureActive: (active: boolean) => void;
	setViewportSize: (size: { width: number; height: number }) => void;
	setHydrated: () => void;
	replaceState: (row: GlobalCanvasLayoutRow) => void;
	toPersistedRow: () => GlobalCanvasLayoutRow;
}

function normalizedOrder(
	order: string[],
	items: Record<string, unknown>,
): string[] {
	const seen = new Set<string>();
	const next = order.filter((id) => {
		if (seen.has(id) || !items[id]) return false;
		seen.add(id);
		return true;
	});
	for (const id of Object.keys(items)) {
		if (!seen.has(id)) next.push(id);
	}
	return next;
}

function captureSnapshot(state: CanvasStore): CanvasHistorySnapshot {
	return {
		windows: state.windows,
		zOrder: state.zOrder,
		shapes: state.shapes,
		shapeOrder: state.shapeOrder,
		dismissedWindowIds: state.dismissedWindowIds,
	};
}

/** Restore a snapshot, pruning volatile references to ids it no longer has. */
function applySnapshot(
	snapshot: CanvasHistorySnapshot,
	state: CanvasStore,
): Partial<CanvasStore> {
	const keepWindows = (ids: ReadonlySet<string>) =>
		new Set([...ids].filter((id) => snapshot.windows[id]));
	const keepShapes = (ids: ReadonlySet<string>) =>
		new Set([...ids].filter((id) => snapshot.shapes[id]));
	return {
		...snapshot,
		focusedWindowId:
			state.focusedWindowId && snapshot.windows[state.focusedWindowId]
				? state.focusedWindowId
				: null,
		selectedWindowIds: keepWindows(state.selectedWindowIds),
		selectedShapeIds: keepShapes(state.selectedShapeIds),
		editingShapeId:
			state.editingShapeId && snapshot.shapes[state.editingShapeId]
				? state.editingShapeId
				: null,
	};
}

export function createCanvasStore(): StoreApi<CanvasStore> {
	return createStore<CanvasStore>()((set, get) => ({
		camera: DEFAULT_CANVAS_CAMERA,
		windows: {},
		zOrder: [],
		shapes: {},
		shapeOrder: [],
		focusedWindowId: null,
		selectedWindowIds: new Set<string>(),
		selectedShapeIds: new Set<string>(),
		activeTool: "select",
		drawStyle: DEFAULT_CANVAS_DRAW_STYLE,
		interactionMode: "drag",
		editingShapeId: null,
		marquee: null,
		undoStack: [],
		redoStack: [],
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
				return { windows, zOrder: normalizedOrder(state.zOrder, windows) };
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
					selectedWindowIds: new Set(
						[...state.selectedWindowIds].filter((id) => !removed.has(id)),
					),
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
				if (!window || window.locked) return state;
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

		upsertShapes: (incoming) => {
			if (incoming.length === 0) return;
			set((state) => {
				const shapes = { ...state.shapes };
				for (const shape of incoming) shapes[shape.id] = shape;
				return {
					shapes,
					shapeOrder: normalizedOrder(state.shapeOrder, shapes),
				};
			});
		},

		removeShapes: (ids) => {
			if (ids.length === 0) return;
			set((state) => {
				const removed = new Set(ids);
				const shapes = { ...state.shapes };
				for (const id of ids) delete shapes[id];
				return {
					shapes,
					shapeOrder: state.shapeOrder.filter((id) => !removed.has(id)),
					selectedShapeIds: new Set(
						[...state.selectedShapeIds].filter((id) => !removed.has(id)),
					),
					editingShapeId:
						state.editingShapeId && removed.has(state.editingShapeId)
							? null
							: state.editingShapeId,
				};
			});
		},

		setShapeText: (id, text) => {
			set((state) => {
				const shape = state.shapes[id];
				if (!shape || shape.type !== "text" || shape.text === text) {
					return state;
				}
				return { shapes: { ...state.shapes, [id]: { ...shape, text } } };
			});
		},

		setShapesStyle: (ids, style) => {
			if (ids.length === 0) return;
			set((state) => {
				const shapes = { ...state.shapes };
				for (const id of ids) {
					const shape = shapes[id];
					if (!shape || shape.locked) continue;
					const next = { ...shape };
					if (style.color !== undefined) {
						// Unknown keys resolve to null, same as "default" — clear rather
						// than persist a key the renderer would ignore anyway.
						if (resolveCanvasShapeColor(style.color)) next.color = style.color;
						else delete next.color;
					}
					if (next.type === "box" && style.fill !== undefined) {
						if (style.fill) next.fill = true;
						else delete next.fill;
					}
					if (next.type === "text") {
						if (style.fontSize !== undefined) {
							if (style.fontSize !== DEFAULT_CANVAS_TEXT_SIZE_PX) {
								next.fontSize = style.fontSize;
							} else {
								delete next.fontSize;
							}
						}
						if (style.bold !== undefined) {
							if (style.bold) next.bold = true;
							else delete next.bold;
						}
						if (style.italic !== undefined) {
							if (style.italic) next.italic = true;
							else delete next.italic;
						}
					}
					shapes[id] = next;
				}
				return { shapes };
			});
		},

		translateItems: (windowIds, shapeIds, dx, dy) => {
			if ((dx === 0 && dy === 0) || (!windowIds.length && !shapeIds.length)) {
				return;
			}
			set((state) => {
				const windows = { ...state.windows };
				for (const id of windowIds) {
					const window = windows[id];
					if (!window || window.locked) continue;
					windows[id] = { ...window, x: window.x + dx, y: window.y + dy };
				}
				const shapes = { ...state.shapes };
				for (const id of shapeIds) {
					const shape = shapes[id];
					if (!shape || shape.locked) continue;
					shapes[id] =
						shape.type === "line"
							? {
									...shape,
									x1: shape.x1 + dx,
									y1: shape.y1 + dy,
									x2: shape.x2 + dx,
									y2: shape.y2 + dy,
								}
							: { ...shape, x: shape.x + dx, y: shape.y + dy };
				}
				return { windows, shapes };
			});
		},

		setItemsLocked: (windowIds, shapeIds, locked) => {
			set((state) => {
				const windows = { ...state.windows };
				for (const id of windowIds) {
					const window = windows[id];
					if (!window || Boolean(window.locked) === locked) continue;
					windows[id] = { ...window, locked };
				}
				const shapes = { ...state.shapes };
				for (const id of shapeIds) {
					const shape = shapes[id];
					if (!shape || Boolean(shape.locked) === locked) continue;
					shapes[id] = { ...shape, locked };
				}
				// Freshly locked items leave the selection — a group drag must
				// not appear to grab them.
				const lockedWindowIds = new Set(locked ? windowIds : []);
				const lockedShapeIds = new Set(locked ? shapeIds : []);
				return {
					windows,
					shapes,
					selectedWindowIds: new Set(
						[...state.selectedWindowIds].filter(
							(id) => !lockedWindowIds.has(id),
						),
					),
					selectedShapeIds: new Set(
						[...state.selectedShapeIds].filter((id) => !lockedShapeIds.has(id)),
					),
				};
			});
		},

		setSelection: (windowIds, shapeIds) => {
			set((state) => ({
				selectedWindowIds: new Set(
					[...windowIds].filter(
						(id) => state.windows[id] && !state.windows[id].locked,
					),
				),
				selectedShapeIds: new Set(
					[...shapeIds].filter(
						(id) => state.shapes[id] && !state.shapes[id].locked,
					),
				),
			}));
		},

		toggleWindowSelection: (id) => {
			set((state) => {
				const window = state.windows[id];
				if (!window || window.locked) return state;
				const next = new Set(state.selectedWindowIds);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return { selectedWindowIds: next };
			});
		},

		toggleShapeSelection: (id) => {
			set((state) => {
				const shape = state.shapes[id];
				if (!shape || shape.locked) return state;
				const next = new Set(state.selectedShapeIds);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return { selectedShapeIds: next };
			});
		},

		clearSelection: () => {
			set((state) =>
				state.selectedWindowIds.size === 0 && state.selectedShapeIds.size === 0
					? state
					: {
							selectedWindowIds: new Set<string>(),
							selectedShapeIds: new Set<string>(),
						},
			);
		},

		setActiveTool: (tool) => {
			set((state) =>
				state.activeTool === tool ? state : { activeTool: tool },
			);
		},

		setDrawStyle: (style) => {
			set((state) => ({ drawStyle: { ...state.drawStyle, ...style } }));
		},

		setInteractionMode: (mode) => {
			set((state) =>
				state.interactionMode === mode ? state : { interactionMode: mode },
			);
		},

		setEditingShape: (id) => {
			set((state) =>
				state.editingShapeId === id ? state : { editingShapeId: id },
			);
		},

		setMarquee: (rect) => {
			set({ marquee: rect });
		},

		pushHistory: () => {
			set((state) => ({
				undoStack: [
					...state.undoStack.slice(-(MAX_HISTORY_ENTRIES - 1)),
					captureSnapshot(state),
				],
				redoStack: [],
			}));
		},

		undo: () => {
			set((state) => {
				const snapshot = state.undoStack[state.undoStack.length - 1];
				if (!snapshot) return state;
				return {
					...applySnapshot(snapshot, state),
					undoStack: state.undoStack.slice(0, -1),
					redoStack: [...state.redoStack, captureSnapshot(state)],
				};
			});
		},

		redo: () => {
			set((state) => {
				const snapshot = state.redoStack[state.redoStack.length - 1];
				if (!snapshot) return state;
				return {
					...applySnapshot(snapshot, state),
					redoStack: state.redoStack.slice(0, -1),
					undoStack: [...state.undoStack, captureSnapshot(state)],
				};
			});
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
			const shapes: Record<string, CanvasShape> = {};
			for (const shape of row.shapes ?? []) shapes[shape.id] = shape;
			set({
				camera: { ...row.camera, zoom: clampZoom(row.camera.zoom) },
				windows,
				zOrder: normalizedOrder(row.zOrder, windows),
				shapes,
				shapeOrder: (row.shapes ?? []).map((shape) => shape.id),
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
				shapes: state.shapeOrder
					.map((id) => state.shapes[id])
					.filter((shape): shape is CanvasShape => Boolean(shape)),
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

/** Every instantiated org canvas store — for cross-cutting cleanup that
 *  doesn't know which org owns a workspace (e.g. workspace close). */
export function getAllCanvasStores(): Iterable<StoreApi<CanvasStore>> {
	return canvasStoreCache.values();
}
