import type { StoreApi } from "zustand/vanilla";
import { browserRuntimeRegistry } from "../$workspaceId/hooks/usePaneRegistry/components/BrowserPane";
import { getShapeBounds } from "./canvasGeometry";
import type { CanvasStore } from "./canvasStore";

/**
 * Drag a group of windows and shapes together. Like the single-window drag in
 * CanvasWindowFrame, position updates during the gesture are imperative style
 * writes on each member's plane element; the store commit (one undoable
 * translateItems) happens on pointerup.
 *
 * Returns a cleanup that cancels the gesture without committing.
 */
export function beginCanvasTranslationGesture({
	store,
	event,
	captureTarget,
	windowIds,
	shapeIds,
}: {
	store: StoreApi<CanvasStore>;
	event: PointerEvent;
	/** Element to hold pointer capture for the drag. */
	captureTarget: Element;
	windowIds: string[];
	shapeIds: string[];
}): (() => void) | null {
	const plane = captureTarget.closest<HTMLElement>("[data-canvas-plane]");
	if (!plane) return null;

	const state = store.getState();
	const members: Array<{
		element: HTMLElement;
		startX: number;
		startY: number;
	}> = [];
	for (const id of windowIds) {
		const window = state.windows[id];
		const element = plane.querySelector<HTMLElement>(
			`[data-canvas-window="${CSS.escape(id)}"]`,
		);
		if (!window || !element) continue;
		members.push({ element, startX: window.x, startY: window.y });
	}
	for (const id of shapeIds) {
		const shape = state.shapes[id];
		const element = plane.querySelector<HTMLElement>(
			`[data-canvas-shape="${CSS.escape(id)}"]`,
		);
		if (!shape || !element) continue;
		const bounds = getShapeBounds(shape);
		members.push({ element, startX: bounds.x, startY: bounds.y });
	}
	if (members.length === 0) return null;

	const pointerId = event.pointerId;
	const startX = event.clientX;
	const startY = event.clientY;
	let deltaX = 0;
	let deltaY = 0;

	try {
		captureTarget.setPointerCapture(pointerId);
	} catch {
		// Capture unsupported on this target; window listeners still track.
	}
	store.getState().setGestureActive(true);
	browserRuntimeRegistry.setShellInteractionPassthrough(true);

	const handleMove = (moveEvent: PointerEvent) => {
		if (moveEvent.pointerId !== pointerId) return;
		const zoom = store.getState().camera.zoom;
		deltaX = (moveEvent.clientX - startX) / zoom;
		deltaY = (moveEvent.clientY - startY) / zoom;
		for (const member of members) {
			member.element.style.left = `${member.startX + deltaX}px`;
			member.element.style.top = `${member.startY + deltaY}px`;
		}
		browserRuntimeRegistry.relayoutAll();
	};

	let finished = false;
	const endGesture = (commit: boolean) => {
		if (finished) return;
		finished = true;
		window.removeEventListener("pointermove", handleMove);
		window.removeEventListener("pointerup", handleEnd);
		window.removeEventListener("pointercancel", handleEnd);
		try {
			captureTarget.releasePointerCapture(pointerId);
		} catch {
			// Capture already released.
		}
		browserRuntimeRegistry.setShellInteractionPassthrough(false);
		if (commit && (deltaX !== 0 || deltaY !== 0)) {
			store.getState().pushHistory();
			store.getState().translateItems(windowIds, shapeIds, deltaX, deltaY);
		} else if (!commit) {
			// Cancelled — snap members back to their committed positions.
			for (const member of members) {
				member.element.style.left = `${member.startX}px`;
				member.element.style.top = `${member.startY}px`;
			}
		}
		store.getState().setGestureActive(false);
		requestAnimationFrame(() => browserRuntimeRegistry.relayoutAll());
	};
	const handleEnd = (endEvent: PointerEvent) => {
		if (endEvent.pointerId !== pointerId) return;
		endGesture(true);
	};

	window.addEventListener("pointermove", handleMove);
	window.addEventListener("pointerup", handleEnd);
	window.addEventListener("pointercancel", handleEnd);
	return () => endGesture(false);
}
