import { describe, expect, it } from "bun:test";
import {
	canvasToScreen,
	clampZoom,
	getContainCamera,
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

describe("getContainCamera", () => {
	const PADDING = 48;

	function screenRect(
		bbox: { x: number; y: number; width: number; height: number },
		camera: { x: number; y: number; zoom: number },
	) {
		const topLeft = canvasToScreen({ x: bbox.x, y: bbox.y }, camera);
		return {
			left: topLeft.x,
			top: topLeft.y,
			right: topLeft.x + bbox.width * camera.zoom,
			bottom: topLeft.y + bbox.height * camera.zoom,
		};
	}

	it("returns the camera unchanged when the box is already contained", () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const bbox = { x: 100, y: 100, width: 400, height: 300 };
		expect(getContainCamera(bbox, camera, VIEWPORT, PADDING)).toBe(camera);
	});

	it("pans the minimum distance on the offending axis only", () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const bbox = { x: -500, y: 100, width: 400, height: 300 };
		const next = getContainCamera(bbox, camera, VIEWPORT, PADDING);
		expect(next.zoom).toBe(1);
		// Left edge lands exactly on the padding; y untouched.
		expect(screenRect(bbox, next).left).toBeCloseTo(PADDING, 6);
		expect(next.y).toBe(camera.y);
	});

	it("pans left when the box hangs off the right edge", () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const bbox = { x: 1000, y: 900, width: 400, height: 300 };
		const next = getContainCamera(bbox, camera, VIEWPORT, PADDING);
		expect(next.zoom).toBe(1);
		const rect = screenRect(bbox, next);
		expect(rect.right).toBeCloseTo(VIEWPORT.width - PADDING, 6);
		expect(rect.bottom).toBeCloseTo(VIEWPORT.height - PADDING, 6);
	});

	it("keeps the current zoom even when far below 1x", () => {
		const camera = { x: 0, y: 0, zoom: 0.5 };
		const bbox = { x: 5000, y: 5000, width: 400, height: 300 };
		const next = getContainCamera(bbox, camera, VIEWPORT, PADDING);
		expect(next.zoom).toBe(0.5);
	});

	it("zooms out and centers when the box cannot fit at the current zoom", () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const bbox = { x: 0, y: 0, width: 2400, height: 600 };
		const next = getContainCamera(bbox, camera, VIEWPORT, PADDING);
		expect(next.zoom).toBeLessThan(1);
		const rect = screenRect(bbox, next);
		expect(rect.left).toBeGreaterThanOrEqual(PADDING - 1e-6);
		expect(rect.right).toBeLessThanOrEqual(VIEWPORT.width - PADDING + 1e-6);
		const centerX = (rect.left + rect.right) / 2;
		expect(centerX).toBeCloseTo(VIEWPORT.width / 2, 4);
	});

	it("clamps the fit zoom to the minimum", () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const bbox = { x: 0, y: 0, width: 500000, height: 500000 };
		expect(getContainCamera(bbox, camera, VIEWPORT, PADDING).zoom).toBe(
			MIN_CANVAS_ZOOM,
		);
	});

	it("is a no-op on an unmeasured viewport", () => {
		const camera = { x: 12, y: 34, zoom: 0.7 };
		const bbox = { x: 9000, y: 9000, width: 400, height: 300 };
		expect(
			getContainCamera(bbox, camera, { width: 0, height: 0 }, PADDING),
		).toBe(camera);
	});
});
