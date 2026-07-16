import type {
	CanvasCamera,
	CanvasShapeRow,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";

export interface CanvasPoint {
	x: number;
	y: number;
}

export interface CanvasRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ViewportSize {
	width: number;
	height: number;
}

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 2;

/** Default size for a freshly-seeded window, in canvas (unzoomed) pixels. */
export const CANVAS_WINDOW_WIDTH = 760;
export const CANVAS_WINDOW_HEIGHT = 520;
export const CANVAS_WINDOW_GAP = 40;

export const MIN_CANVAS_WINDOW_WIDTH = 320;
export const MIN_CANVAS_WINDOW_HEIGHT = 200;

/** Below this zoom, terminal windows render as placeholder cards. */
export const TERMINAL_PLACEHOLDER_ZOOM = 0.35;

/** Hard cap on simultaneously-mounted xterm runtimes on the canvas. Kept
 *  well under the browser's ~16 WebGL context limit — the context-loss
 *  fallback permanently flips ALL terminals to the DOM renderer, so it must
 *  never trip. */
export const MAX_LIVE_CANVAS_TERMINALS = 10;

export function clampZoom(zoom: number): number {
	return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function screenToCanvas(
	point: CanvasPoint,
	camera: CanvasCamera,
): CanvasPoint {
	return {
		x: (point.x - camera.x) / camera.zoom,
		y: (point.y - camera.y) / camera.zoom,
	};
}

export function canvasToScreen(
	point: CanvasPoint,
	camera: CanvasCamera,
): CanvasPoint {
	return {
		x: point.x * camera.zoom + camera.x,
		y: point.y * camera.zoom + camera.y,
	};
}

/**
 * Zoom while keeping the canvas point under `screenPoint` (viewport-relative)
 * stationary on screen.
 */
export function zoomAtPoint(
	camera: CanvasCamera,
	screenPoint: CanvasPoint,
	nextZoom: number,
): CanvasCamera {
	const zoom = clampZoom(nextZoom);
	const anchor = screenToCanvas(screenPoint, camera);
	return {
		zoom,
		x: screenPoint.x - anchor.x * zoom,
		y: screenPoint.y - anchor.y * zoom,
	};
}

function getViewportCanvasRect(
	camera: CanvasCamera,
	viewport: ViewportSize,
	marginPct = 0,
): CanvasRect {
	const topLeft = screenToCanvas({ x: 0, y: 0 }, camera);
	const width = viewport.width / camera.zoom;
	const height = viewport.height / camera.zoom;
	return {
		x: topLeft.x - width * marginPct,
		y: topLeft.y - height * marginPct,
		width: width * (1 + marginPct * 2),
		height: height * (1 + marginPct * 2),
	};
}

/** Axis-aligned rect spanning two corner points (any drag direction). */
export function rectFromPoints(a: CanvasPoint, b: CanvasPoint): CanvasRect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(a.x - b.x),
		height: Math.abs(a.y - b.y),
	};
}

export function getShapeBounds(shape: CanvasShapeRow): CanvasRect {
	if (shape.type === "line") {
		return rectFromPoints(
			{ x: shape.x1, y: shape.y1 },
			{ x: shape.x2, y: shape.y2 },
		);
	}
	return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

export function rectsIntersect(a: CanvasRect, b: CanvasRect): boolean {
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

/**
 * Windows whose rect intersects the viewport plus `marginPct` margin on every
 * side (default 50% — a viewport-width halo pre-mounts near neighbours).
 */
export function getVisibleWindowIds(
	windows: Iterable<{ id: string } & CanvasRect>,
	camera: CanvasCamera,
	viewport: ViewportSize,
	marginPct = 0.5,
): Set<string> {
	const view = getViewportCanvasRect(camera, viewport, marginPct);
	const visible = new Set<string>();
	for (const window of windows) {
		if (rectsIntersect(window, view)) visible.add(window.id);
	}
	return visible;
}

/**
 * Which terminal windows may mount a real xterm runtime: the closest
 * `maxLive` visible windows by distance from the viewport center, always
 * including the focused window. Below TERMINAL_PLACEHOLDER_ZOOM nothing is
 * live — text is unreadable there anyway.
 */
export function pickLiveTerminalWindowIds({
	windows,
	camera,
	viewport,
	focusedWindowId,
	maxLive = MAX_LIVE_CANVAS_TERMINALS,
}: {
	windows: Array<{ id: string } & CanvasRect>;
	camera: CanvasCamera;
	viewport: ViewportSize;
	focusedWindowId: string | null;
	maxLive?: number;
}): Set<string> {
	if (camera.zoom < TERMINAL_PLACEHOLDER_ZOOM) return new Set();
	const visible = getVisibleWindowIds(windows, camera, viewport);
	const center = screenToCanvas(
		{ x: viewport.width / 2, y: viewport.height / 2 },
		camera,
	);
	const byDistance = windows
		.filter((window) => visible.has(window.id))
		.map((window) => ({
			id: window.id,
			distance: Math.hypot(
				window.x + window.width / 2 - center.x,
				window.y + window.height / 2 - center.y,
			),
		}))
		.sort((a, b) => a.distance - b.distance);

	const live = new Set<string>();
	if (focusedWindowId && windows.some((w) => w.id === focusedWindowId)) {
		live.add(focusedWindowId);
	}
	for (const candidate of byDistance) {
		if (live.size >= maxLive) break;
		live.add(candidate.id);
	}
	return live;
}

export function getWindowsBoundingBox(
	windows: Array<CanvasRect>,
): CanvasRect | null {
	if (windows.length === 0) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const w of windows) {
		minX = Math.min(minX, w.x);
		minY = Math.min(minY, w.y);
		maxX = Math.max(maxX, w.x + w.width);
		maxY = Math.max(maxY, w.y + w.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Grid placement for newly-seeded windows. With no existing windows the grid
 * starts at the origin, `ceil(sqrt(n))` columns wide; with existing windows
 * new rows are appended below their bounding box so nothing overlaps.
 * Callers pass `toPlace` pre-sorted (e.g. grouped by workspace) so related
 * windows land adjacent.
 */
export function planWindowPlacements({
	existing,
	toPlaceCount,
	cellWidth = CANVAS_WINDOW_WIDTH,
	cellHeight = CANVAS_WINDOW_HEIGHT,
	gap = CANVAS_WINDOW_GAP,
}: {
	existing: CanvasRect[];
	toPlaceCount: number;
	cellWidth?: number;
	cellHeight?: number;
	gap?: number;
}): CanvasRect[] {
	if (toPlaceCount <= 0) return [];
	const bbox = getWindowsBoundingBox(existing);
	const originX = bbox ? bbox.x : 0;
	const originY = bbox ? bbox.y + bbox.height + gap : 0;
	const columns = Math.max(1, Math.ceil(Math.sqrt(toPlaceCount)));

	const placements: CanvasRect[] = [];
	for (let i = 0; i < toPlaceCount; i++) {
		const col = i % columns;
		const row = Math.floor(i / columns);
		placements.push({
			x: originX + col * (cellWidth + gap),
			y: originY + row * (cellHeight + gap),
			width: cellWidth,
			height: cellHeight,
		});
	}
	return placements;
}

/**
 * Camera that frames every window with `padding` screen pixels on each side,
 * zoom clamped to [MIN_CANVAS_ZOOM, 1] (fit never magnifies).
 */
export function getZoomToFitCamera(
	windows: Array<CanvasRect>,
	viewport: ViewportSize,
	padding = 48,
): CanvasCamera {
	const bbox = getWindowsBoundingBox(windows);
	if (!bbox || viewport.width <= 0 || viewport.height <= 0) {
		return { x: 0, y: 0, zoom: 1 };
	}
	const availableWidth = Math.max(1, viewport.width - padding * 2);
	const availableHeight = Math.max(1, viewport.height - padding * 2);
	const zoom = clampZoom(
		Math.min(1, availableWidth / bbox.width, availableHeight / bbox.height),
	);
	return {
		zoom,
		x: viewport.width / 2 - (bbox.x + bbox.width / 2) * zoom,
		y: viewport.height / 2 - (bbox.y + bbox.height / 2) * zoom,
	};
}
