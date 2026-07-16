import { describe, expect, it } from "bun:test";
import {
	canvasToScreen,
	clampZoom,
	getVisibleWindowIds,
	getWindowsBoundingBox,
	getZoomToFitCamera,
	MAX_CANVAS_ZOOM,
	MIN_CANVAS_ZOOM,
	pickLiveTerminalWindowIds,
	planWindowPlacements,
	screenToCanvas,
	zoomAtPoint,
} from "./canvasGeometry";

const VIEWPORT = { width: 1200, height: 800 };

function makeWindow(id: string, x: number, y: number, size = 400) {
	return { id, x, y, width: size, height: size };
}

describe("screen/canvas conversion", () => {
	it("round-trips through both directions", () => {
		const camera = { x: 133, y: -87, zoom: 1.4 };
		const point = { x: 421, y: 267 };
		expect(canvasToScreen(screenToCanvas(point, camera), camera)).toEqual({
			x: point.x,
			y: point.y,
		});
	});

	it("is identity at the default camera", () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		expect(screenToCanvas({ x: 5, y: 9 }, camera)).toEqual({ x: 5, y: 9 });
	});
});

describe("zoomAtPoint", () => {
	it("keeps the canvas point under the cursor stationary", () => {
		const camera = { x: 50, y: -20, zoom: 0.8 };
		const cursor = { x: 300, y: 200 };
		const anchor = screenToCanvas(cursor, camera);
		const next = zoomAtPoint(camera, cursor, 1.5);
		expect(canvasToScreen(anchor, next).x).toBeCloseTo(cursor.x, 6);
		expect(canvasToScreen(anchor, next).y).toBeCloseTo(cursor.y, 6);
	});

	it("clamps zoom to the allowed range", () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		expect(zoomAtPoint(camera, { x: 0, y: 0 }, 99).zoom).toBe(MAX_CANVAS_ZOOM);
		expect(zoomAtPoint(camera, { x: 0, y: 0 }, 0).zoom).toBe(MIN_CANVAS_ZOOM);
		expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_CANVAS_ZOOM);
	});
});

describe("getVisibleWindowIds", () => {
	it("includes on-screen and margin windows, excludes far ones", () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const windows = [
			makeWindow("on", 100, 100),
			// Inside the 50% margin halo (viewport is 1200 wide → halo to 1800).
			makeWindow("near", 1400, 100),
			makeWindow("far", 5000, 5000),
		];
		const visible = getVisibleWindowIds(windows, camera, VIEWPORT);
		expect(visible.has("on")).toBe(true);
		expect(visible.has("near")).toBe(true);
		expect(visible.has("far")).toBe(false);
	});

	it("accounts for the camera transform", () => {
		const windows = [makeWindow("w", 5000, 5000)];
		const centered = { x: -4800, y: -4800, zoom: 1 };
		expect(getVisibleWindowIds(windows, centered, VIEWPORT).has("w")).toBe(
			true,
		);
	});
});

describe("pickLiveTerminalWindowIds", () => {
	it("stays live at any zoom level while visible", () => {
		const windows = [makeWindow("a", 0, 0)];
		const live = pickLiveTerminalWindowIds({
			windows,
			camera: { x: 0, y: 0, zoom: 0.1 },
			viewport: VIEWPORT,
			focusedWindowId: null,
		});
		expect(live.has("a")).toBe(true);
	});

	it("caps at maxLive with only visible windows", () => {
		const windows = Array.from({ length: 6 }, (_, i) =>
			makeWindow(`w${i}`, i * 150, 0, 100),
		);
		const live = pickLiveTerminalWindowIds({
			windows,
			camera: { x: 0, y: 0, zoom: 1 },
			viewport: VIEWPORT,
			focusedWindowId: null,
			maxLive: 3,
		});
		expect(live.size).toBe(3);
		for (const id of live) {
			expect(windows.some((window) => window.id === id)).toBe(true);
		}
	});

	it("skips off-screen windows when filling the cap", () => {
		const windows = [
			makeWindow("off", -10_000, -10_000, 100),
			makeWindow("on", 0, 0, 100),
		];
		const live = pickLiveTerminalWindowIds({
			windows,
			camera: { x: 0, y: 0, zoom: 1 },
			viewport: VIEWPORT,
			focusedWindowId: null,
			maxLive: 1,
		});
		expect(live.has("on")).toBe(true);
		expect(live.has("off")).toBe(false);
	});

	it("always includes the focused window", () => {
		const windows = Array.from({ length: 5 }, (_, i) =>
			makeWindow(`w${i}`, i * 150, 0, 100),
		);
		const live = pickLiveTerminalWindowIds({
			windows,
			camera: { x: 0, y: 0, zoom: 1 },
			viewport: VIEWPORT,
			focusedWindowId: "w0",
			maxLive: 2,
		});
		expect(live.has("w0")).toBe(true);
		expect(live.size).toBe(2);
	});
});

describe("planWindowPlacements", () => {
	it("lays out a square-ish grid from the origin when empty", () => {
		const placements = planWindowPlacements({
			existing: [],
			toPlaceCount: 5,
			cellWidth: 100,
			cellHeight: 100,
			gap: 10,
		});
		expect(placements).toHaveLength(5);
		expect(placements[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 });
		// ceil(sqrt(5)) = 3 columns → index 3 wraps to row 1.
		expect(placements[3]).toEqual({ x: 0, y: 110, width: 100, height: 100 });
		// No overlaps.
		const keys = new Set(placements.map((p) => `${p.x}:${p.y}`));
		expect(keys.size).toBe(5);
	});

	it("appends below the bounding box of existing windows", () => {
		const placements = planWindowPlacements({
			existing: [makeWindow("e", 40, 60, 200)],
			toPlaceCount: 1,
			cellWidth: 100,
			cellHeight: 100,
			gap: 10,
		});
		expect(placements[0].x).toBe(40);
		expect(placements[0].y).toBe(60 + 200 + 10);
	});

	it("returns empty for zero count", () => {
		expect(planWindowPlacements({ existing: [], toPlaceCount: 0 })).toEqual([]);
	});
});

describe("getZoomToFitCamera", () => {
	it("frames the bounding box centered in the viewport", () => {
		const windows = [makeWindow("a", 0, 0, 400), makeWindow("b", 2000, 0, 400)];
		const camera = getZoomToFitCamera(windows, VIEWPORT, 48);
		const bbox = getWindowsBoundingBox(windows);
		if (!bbox) throw new Error("expected bbox");
		const center = canvasToScreen(
			{ x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
			camera,
		);
		expect(center.x).toBeCloseTo(VIEWPORT.width / 2, 4);
		expect(center.y).toBeCloseTo(VIEWPORT.height / 2, 4);
		// Everything fits inside the padded viewport.
		expect(bbox.width * camera.zoom).toBeLessThanOrEqual(
			VIEWPORT.width - 48 * 2 + 1e-6,
		);
	});

	it("never magnifies above 1x and handles empty input", () => {
		const camera = getZoomToFitCamera([makeWindow("tiny", 0, 0, 50)], VIEWPORT);
		expect(camera.zoom).toBe(1);
		expect(getZoomToFitCamera([], VIEWPORT)).toEqual({ x: 0, y: 0, zoom: 1 });
	});
});
