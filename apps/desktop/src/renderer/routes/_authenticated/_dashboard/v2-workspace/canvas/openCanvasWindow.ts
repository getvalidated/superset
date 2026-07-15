import type { CanvasWindowRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import type { StoreApi } from "zustand/vanilla";
import { planWindowPlacements } from "./canvasGeometry";
import type { CanvasStore } from "./canvasStore";

/** Canvas-only search window payload. Bound to the workspace it was opened
 *  from via the window's workspaceId. */
export interface CanvasSearchData {
	query?: string;
}

/** Canvas-only settings window payload. Org-global (workspaceId ""). */
export interface CanvasSettingsData {
	section: string;
}

export const CANVAS_WINDOW_DEFAULT_SIZES: Record<
	CanvasWindowRow["kind"],
	{ width: number; height: number }
> = {
	terminal: { width: 640, height: 420 },
	browser: { width: 800, height: 560 },
	file: { width: 720, height: 520 },
	diff: { width: 860, height: 600 },
	chat: { width: 520, height: 620 },
	comment: { width: 440, height: 480 },
	search: { width: 480, height: 560 },
	settings: { width: 860, height: 620 },
};

/** Deterministic window ids so re-opening the same thing focuses the
 *  existing window instead of stacking duplicates. */
export const canvasWindowIds = {
	file: (workspaceId: string, filePath: string) =>
		`file:${workspaceId}:${filePath}`,
	/** One diff window per workspace, mirroring tabs mode's single diff pane. */
	diff: (workspaceId: string) => `diff:${workspaceId}`,
	/** One comment window per workspace, mirroring tabs mode's reuse. */
	comment: (workspaceId: string) => `comment:${workspaceId}`,
	settings: () => "settings",
};

export interface OpenCanvasWindowInput {
	id: string;
	kind: CanvasWindowRow["kind"];
	/** "" for org-global windows (search, settings). */
	workspaceId: string;
	data: unknown;
	width?: number;
	height?: number;
	ephemeral?: boolean;
	/** When a window with this id already exists: replace its data (default)
	 *  or keep what it has. Either way it's focused and raised. */
	onExisting?: "replace-data" | "keep-data";
}

/**
 * Open (or focus) a window on the global canvas. New windows are placed
 * centered in the current viewport with a small cascade so consecutive opens
 * don't stack exactly; if the viewport hasn't been measured yet, placement
 * falls back to the packing planner used by seeding.
 */
export function openCanvasWindow(
	store: StoreApi<CanvasStore>,
	input: OpenCanvasWindowInput,
): void {
	const state = store.getState();
	const existing = state.windows[input.id];
	if (existing) {
		if (input.onExisting !== "keep-data") {
			state.updateWindowData(input.id, input.data);
		}
		state.bringToFront(input.id);
		state.setFocusedWindow(input.id);
		return;
	}

	const defaults = CANVAS_WINDOW_DEFAULT_SIZES[input.kind];
	const width = input.width ?? defaults.width;
	const height = input.height ?? defaults.height;

	let x: number;
	let y: number;
	const { camera, viewportSize } = state;
	if (viewportSize.width > 0 && viewportSize.height > 0) {
		// Viewport center in canvas (unzoomed) coordinates.
		const centerX = (viewportSize.width / 2 - camera.x) / camera.zoom;
		const centerY = (viewportSize.height / 2 - camera.y) / camera.zoom;
		const cascade = (state.zOrder.length % 5) * 32;
		x = centerX - width / 2 + cascade;
		y = centerY - height / 2 + cascade;
	} else {
		const [placement] = planWindowPlacements({
			existing: Object.values(state.windows),
			toPlaceCount: 1,
		});
		x = placement.x;
		y = placement.y;
	}

	state.upsertWindows([
		{
			id: input.id,
			kind: input.kind,
			workspaceId: input.workspaceId,
			x,
			y,
			width,
			height,
			data: input.data,
			...(input.ephemeral ? { ephemeral: true } : {}),
		},
	]);
	state.bringToFront(input.id);
	state.setFocusedWindow(input.id);
}
