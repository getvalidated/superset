import { describe, expect, it } from "bun:test";
import {
	type CanvasShape,
	type CanvasWindow,
	createCanvasStore,
} from "./canvasStore";

function makeWindow(
	id: string,
	overrides: Partial<CanvasWindow> = {},
): CanvasWindow {
	return {
		id,
		kind: "terminal",
		workspaceId: "ws-1",
		x: 0,
		y: 0,
		width: 400,
		height: 300,
		data: { terminalId: id },
		...overrides,
	};
}

function makeBox(id: string): CanvasShape {
	return { id, type: "box", x: 10, y: 10, width: 100, height: 80 };
}

function makeLine(id: string): CanvasShape {
	return { id, type: "line", x1: 0, y1: 0, x2: 50, y2: 20 };
}

describe("canvasStore", () => {
	it("upserts windows and keeps zOrder covering exactly the window ids", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a"), makeWindow("b")]);
		expect(Object.keys(store.getState().windows).sort()).toEqual(["a", "b"]);
		expect(store.getState().zOrder.sort()).toEqual(["a", "b"]);
	});

	it("preserves user geometry on re-upsert, refreshing data only", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a")]);
		store
			.getState()
			.setWindowGeometry("a", { x: 42, y: 24, width: 500, height: 400 });
		store
			.getState()
			.upsertWindows([
				makeWindow("a", { data: { terminalId: "a", title: "t" } }),
			]);
		const window = store.getState().windows.a;
		expect(window.x).toBe(42);
		expect(window.width).toBe(500);
		expect(window.data).toEqual({ terminalId: "a", title: "t" });
	});

	it("bringToFront moves the id to the end of zOrder", () => {
		const store = createCanvasStore();
		store
			.getState()
			.upsertWindows([makeWindow("a"), makeWindow("b"), makeWindow("c")]);
		store.getState().bringToFront("a");
		expect(store.getState().zOrder[2]).toBe("a");
		// No-ops don't create new state.
		const before = store.getState().zOrder;
		store.getState().bringToFront("a");
		expect(store.getState().zOrder).toBe(before);
	});

	it("removeWindows clears zOrder, focus, and records dismissals", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a"), makeWindow("b")]);
		store.getState().setFocusedWindow("a");
		store.getState().removeWindows(["a"], { dismiss: true });
		expect(store.getState().windows.a).toBeUndefined();
		expect(store.getState().zOrder).toEqual(["b"]);
		expect(store.getState().focusedWindowId).toBeNull();
		expect(store.getState().dismissedWindowIds.has("a")).toBe(true);
	});

	it("round-trips through toPersistedRow / replaceState", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a"), makeWindow("b")]);
		store.getState().bringToFront("a");
		store.getState().setCamera({ x: 10, y: -5, zoom: 1.5 });
		const row = store.getState().toPersistedRow();
		expect(row.zOrder).toEqual(["b", "a"]);
		expect(row.windows.map((w) => w.id)).toEqual(["b", "a"]);

		const restored = createCanvasStore();
		restored.getState().replaceState(row);
		expect(restored.getState().zOrder).toEqual(["b", "a"]);
		expect(restored.getState().camera).toEqual({ x: 10, y: -5, zoom: 1.5 });
		expect(restored.getState().windows.a).toEqual(store.getState().windows.a);
	});

	it("replaceState heals a zOrder that misses windows", () => {
		const store = createCanvasStore();
		store.getState().replaceState({
			id: "canvas",
			version: 1,
			camera: { x: 0, y: 0, zoom: 1 },
			windows: [makeWindow("a"), makeWindow("b")],
			zOrder: ["b"],
			shapes: [],
		});
		expect(store.getState().zOrder).toEqual(["b", "a"]);
	});

	it("clamps camera zoom", () => {
		const store = createCanvasStore();
		store.getState().setCamera({ x: 0, y: 0, zoom: 50 });
		expect(store.getState().camera.zoom).toBe(2);
	});

	it("round-trips shapes through toPersistedRow / replaceState", () => {
		const store = createCanvasStore();
		store.getState().upsertShapes([makeBox("s1"), makeLine("s2")]);
		const row = store.getState().toPersistedRow();
		expect(row.shapes.map((shape) => shape.id)).toEqual(["s1", "s2"]);

		const restored = createCanvasStore();
		restored.getState().replaceState(row);
		expect(restored.getState().shapeOrder).toEqual(["s1", "s2"]);
		expect(restored.getState().shapes.s1).toEqual(store.getState().shapes.s1);
	});

	it("removeShapes prunes selection and editing state", () => {
		const store = createCanvasStore();
		store.getState().upsertShapes([makeBox("s1"), makeBox("s2")]);
		store.getState().setSelection([], ["s1", "s2"]);
		store.getState().setEditingShape("s1");
		store.getState().removeShapes(["s1"]);
		expect(store.getState().shapeOrder).toEqual(["s2"]);
		expect([...store.getState().selectedShapeIds]).toEqual(["s2"]);
		expect(store.getState().editingShapeId).toBeNull();
	});

	it("translateItems moves windows and shapes by the delta", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a")]);
		store.getState().upsertShapes([makeBox("s1"), makeLine("s2")]);
		store.getState().translateItems(["a"], ["s1", "s2"], 10, -5);
		expect(store.getState().windows.a.x).toBe(10);
		expect(store.getState().windows.a.y).toBe(-5);
		const box = store.getState().shapes.s1;
		expect(box.type === "box" && box.x).toBe(20);
		const line = store.getState().shapes.s2;
		expect(line.type === "line" && line.x1).toBe(10);
		expect(line.type === "line" && line.y2).toBe(15);
	});

	it("setSelection drops ids that don't exist", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a")]);
		store.getState().setSelection(["a", "ghost"], ["ghost"]);
		expect([...store.getState().selectedWindowIds]).toEqual(["a"]);
		expect(store.getState().selectedShapeIds.size).toBe(0);
	});

	it("undo/redo restore document changes and clear on new mutations", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a")]);

		store.getState().pushHistory();
		store
			.getState()
			.setWindowGeometry("a", { x: 100, y: 0, width: 400, height: 300 });
		store.getState().pushHistory();
		store.getState().upsertShapes([makeBox("s1")]);

		store.getState().undo();
		expect(store.getState().shapes.s1).toBeUndefined();
		expect(store.getState().windows.a.x).toBe(100);

		store.getState().undo();
		expect(store.getState().windows.a.x).toBe(0);

		store.getState().redo();
		expect(store.getState().windows.a.x).toBe(100);
		expect(store.getState().shapes.s1).toBeUndefined();
		store.getState().redo();
		expect(store.getState().shapes.s1).toBeDefined();

		// A fresh mutation invalidates the redo branch.
		store.getState().undo();
		store.getState().pushHistory();
		store.getState().removeShapes(["s1"]);
		expect(store.getState().redoStack.length).toBe(0);
	});

	it("undo of a dismissal restores the window and its dismissed marker", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a")]);
		store.getState().pushHistory();
		store.getState().removeWindows(["a"], { dismiss: true });
		expect(store.getState().dismissedWindowIds.has("a")).toBe(true);

		store.getState().undo();
		expect(store.getState().windows.a).toBeDefined();
		expect(store.getState().dismissedWindowIds.has("a")).toBe(false);

		store.getState().redo();
		expect(store.getState().windows.a).toBeUndefined();
		expect(store.getState().dismissedWindowIds.has("a")).toBe(true);
	});

	it("locked windows ignore geometry writes and translation", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a"), makeWindow("b")]);
		store.getState().setItemsLocked(["a"], [], true);
		store
			.getState()
			.setWindowGeometry("a", { x: 99, y: 99, width: 500, height: 400 });
		expect(store.getState().windows.a.x).toBe(0);
		store.getState().translateItems(["a", "b"], [], 10, 10);
		expect(store.getState().windows.a.x).toBe(0);
		expect(store.getState().windows.b.x).toBe(10);
	});

	it("locked shapes ignore translation", () => {
		const store = createCanvasStore();
		store.getState().upsertShapes([makeBox("s1"), makeLine("s2")]);
		store.getState().setItemsLocked([], ["s1"], true);
		store.getState().translateItems([], ["s1", "s2"], 5, 5);
		const box = store.getState().shapes.s1;
		expect(box.type === "box" && box.x).toBe(10);
		const line = store.getState().shapes.s2;
		expect(line.type === "line" && line.x1).toBe(5);
	});

	it("locking drops items from the selection and blocks re-selection", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a")]);
		store.getState().upsertShapes([makeBox("s1")]);
		store.getState().setSelection(["a"], ["s1"]);
		store.getState().setItemsLocked(["a"], ["s1"], true);
		expect(store.getState().selectedWindowIds.size).toBe(0);
		expect(store.getState().selectedShapeIds.size).toBe(0);
		store.getState().setSelection(["a"], ["s1"]);
		expect(store.getState().selectedWindowIds.size).toBe(0);
		store.getState().toggleWindowSelection("a");
		store.getState().toggleShapeSelection("s1");
		expect(store.getState().selectedWindowIds.size).toBe(0);
		expect(store.getState().selectedShapeIds.size).toBe(0);
		store.getState().setItemsLocked(["a"], ["s1"], false);
		store.getState().setSelection(["a"], ["s1"]);
		expect([...store.getState().selectedWindowIds]).toEqual(["a"]);
		expect([...store.getState().selectedShapeIds]).toEqual(["s1"]);
	});

	it("locked state persists through toPersistedRow / replaceState", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a")]);
		store.getState().upsertShapes([makeBox("s1")]);
		store.getState().setItemsLocked(["a"], ["s1"], true);
		const restored = createCanvasStore();
		restored.getState().replaceState(store.getState().toPersistedRow());
		expect(restored.getState().windows.a.locked).toBe(true);
		expect(restored.getState().shapes.s1.locked).toBe(true);
	});

	it("lock toggles are undoable", () => {
		const store = createCanvasStore();
		store.getState().upsertWindows([makeWindow("a")]);
		store.getState().pushHistory();
		store.getState().setItemsLocked(["a"], [], true);
		expect(store.getState().windows.a.locked).toBe(true);
		store.getState().undo();
		expect(store.getState().windows.a.locked).toBeUndefined();
		store.getState().redo();
		expect(store.getState().windows.a.locked).toBe(true);
	});

	it("undo prunes selection and focus to surviving ids", () => {
		const store = createCanvasStore();
		store.getState().pushHistory();
		store.getState().upsertWindows([makeWindow("a")]);
		store.getState().setFocusedWindow("a");
		store.getState().setSelection(["a"], []);
		store.getState().undo();
		expect(store.getState().focusedWindowId).toBeNull();
		expect(store.getState().selectedWindowIds.size).toBe(0);
	});
});
