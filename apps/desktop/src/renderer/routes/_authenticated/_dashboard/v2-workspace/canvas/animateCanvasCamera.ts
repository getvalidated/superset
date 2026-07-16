import type { CanvasCamera } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import type { StoreApi } from "zustand/vanilla";
import type { CanvasStore } from "./canvasStore";

const CAMERA_ANIMATION_MS = 320;

/** One in-flight animation per store — starting a new one cancels the old. */
const activeAnimations = new WeakMap<StoreApi<CanvasStore>, () => void>();

function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Glide the store camera to `target`. Aborts as soon as a pan/zoom gesture
 * starts or anything else writes the camera mid-flight, so it never fights
 * user input; the camera simply stays wherever the other writer put it.
 */
export function animateCanvasCamera(
	store: StoreApi<CanvasStore>,
	target: CanvasCamera,
	durationMs = CAMERA_ANIMATION_MS,
): void {
	activeAnimations.get(store)?.();
	const from = store.getState().camera;
	if (from.x === target.x && from.y === target.y && from.zoom === target.zoom) {
		return;
	}

	let frame = 0;
	let start: number | null = null;
	// setCamera clones, so tracking the last object we caused it to store
	// detects any interleaved write by identity.
	let lastWritten = from;
	activeAnimations.set(store, () => cancelAnimationFrame(frame));

	const step = (now: number) => {
		const state = store.getState();
		if (state.gestureActive || state.camera !== lastWritten) return;
		if (start === null) start = now;
		const t = Math.min(1, (now - start) / durationMs);
		const eased = easeInOutCubic(t);
		state.setCamera({
			x: from.x + (target.x - from.x) * eased,
			y: from.y + (target.y - from.y) * eased,
			zoom: from.zoom + (target.zoom - from.zoom) * eased,
		});
		lastWritten = store.getState().camera;
		if (t < 1) frame = requestAnimationFrame(step);
	};
	frame = requestAnimationFrame(step);
}
