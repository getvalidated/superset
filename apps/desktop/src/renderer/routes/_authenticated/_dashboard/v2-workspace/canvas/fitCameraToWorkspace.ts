import type { StoreApi } from "zustand/vanilla";
import { animateCanvasCamera } from "./animateCanvasCamera";
import { getContainCamera, getWindowsBoundingBox } from "./canvasGeometry";
import type { CanvasStore } from "./canvasStore";

/**
 * Reveal a workspace's canvas windows: focus its topmost one (so the
 * sidebar's focused-window → workspace resolution agrees with the click
 * instead of staying on the previously focused workspace) and glide the
 * camera the minimum distance that contains their bounding box, zooming out
 * only when they can't fit at the current zoom. No-op when the workspace has
 * nothing on the canvas; camera movement is skipped while the viewport is
 * unmeasured (canvas not yet laid out).
 */
export function fitCanvasCameraToWorkspace(
	store: StoreApi<CanvasStore>,
	workspaceId: string,
): void {
	const state = store.getState();
	const windows = Object.values(state.windows).filter(
		(window) => window.workspaceId === workspaceId,
	);
	const bbox = getWindowsBoundingBox(windows);
	if (!bbox) return;

	for (let i = state.zOrder.length - 1; i >= 0; i--) {
		const window = state.windows[state.zOrder[i]];
		if (window?.workspaceId === workspaceId) {
			state.setFocusedWindow(window.id);
			break;
		}
	}

	animateCanvasCamera(
		store,
		getContainCamera(bbox, state.camera, state.viewportSize),
	);
}
