import { describe, expect, it } from "bun:test";
import { type CanvasWindow, createCanvasStore } from "./canvasStore";

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
		});
		expect(store.getState().zOrder).toEqual(["b", "a"]);
	});

	it("clamps camera zoom", () => {
		const store = createCanvasStore();
		store.getState().setCamera({ x: 0, y: 0, zoom: 50 });
		expect(store.getState().camera.zoom).toBe(2);
	});
});
