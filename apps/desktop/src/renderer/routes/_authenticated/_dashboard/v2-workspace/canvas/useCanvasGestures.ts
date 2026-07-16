import { type RefObject, useEffect, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import { browserRuntimeRegistry } from "../$workspaceId/hooks/usePaneRegistry/components/BrowserPane";
import {
	clampZoom,
	getShapeBounds,
	rectFromPoints,
	rectsIntersect,
	screenToCanvas,
	zoomAtPoint,
} from "./canvasGeometry";
import type { CanvasStore } from "./canvasStore";

const WHEEL_GESTURE_END_MS = 250;

export function isTextEntryTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Pan/zoom/selection gestures for the canvas viewport:
 * - two-finger scroll pans (except over a window body, where it scrolls the
 *   terminal buffer / page)
 * - ctrl/cmd + wheel (= trackpad pinch in Chromium) zooms at the cursor
 * - middle-button drag, space-held drag, and background left-drag pan
 * - shift + background left-drag marquee-selects windows and shapes
 *
 * Camera writes go through the store; the view applies them imperatively.
 * While any gesture is active, webview pointer events are passed through so
 * a drag across a browser window isn't swallowed by the guest page.
 */
export function useCanvasGestures({
	viewportRef,
	store,
	onGestureEnd,
}: {
	viewportRef: RefObject<HTMLDivElement | null>;
	store: StoreApi<CanvasStore>;
	onGestureEnd: () => void;
}): void {
	const onGestureEndRef = useRef(onGestureEnd);
	onGestureEndRef.current = onGestureEnd;

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;

		let wheelEndTimer: ReturnType<typeof setTimeout> | null = null;
		let spaceDown = false;
		let panPointerId: number | null = null;
		let panStart: {
			x: number;
			y: number;
			cameraX: number;
			cameraY: number;
		} | null = null;
		let marqueePointerId: number | null = null;
		/** Marquee anchor in viewport (screen) coordinates. */
		let marqueeStart: { x: number; y: number } | null = null;

		const resetMarquee = () => {
			if (marqueePointerId === null) return;
			marqueePointerId = null;
			marqueeStart = null;
			store.getState().setMarquee(null);
		};

		const beginGesture = () => {
			if (!store.getState().gestureActive) {
				store.getState().setGestureActive(true);
				browserRuntimeRegistry.setShellInteractionPassthrough(true);
			}
		};

		const endGesture = () => {
			if (wheelEndTimer) {
				clearTimeout(wheelEndTimer);
				wheelEndTimer = null;
			}
			if (store.getState().gestureActive) {
				browserRuntimeRegistry.setShellInteractionPassthrough(false);
				store.getState().setGestureActive(false);
				onGestureEndRef.current();
			}
		};

		const scheduleWheelEnd = () => {
			if (wheelEndTimer) clearTimeout(wheelEndTimer);
			wheelEndTimer = setTimeout(endGesture, WHEEL_GESTURE_END_MS);
		};

		const handleWheel = (event: WheelEvent) => {
			const { camera } = store.getState();
			if (event.ctrlKey || event.metaKey) {
				// Pinch/zoom — never let xterm or the page see it.
				event.preventDefault();
				event.stopPropagation();
				const rect = viewport.getBoundingClientRect();
				const point = {
					x: event.clientX - rect.left,
					y: event.clientY - rect.top,
				};
				const factor = Math.exp(-event.deltaY * 0.01);
				store
					.getState()
					.setCamera(
						zoomAtPoint(camera, point, clampZoom(camera.zoom * factor)),
					);
				beginGesture();
				scheduleWheelEnd();
				return;
			}
			// Plain scroll over a window body belongs to the window content.
			if (
				event.target instanceof HTMLElement &&
				event.target.closest("[data-canvas-window]")
			) {
				return;
			}
			event.preventDefault();
			store.getState().setCamera({
				...camera,
				x: camera.x - event.deltaX,
				y: camera.y - event.deltaY,
			});
			beginGesture();
			scheduleWheelEnd();
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (panPointerId !== null || marqueePointerId !== null) return;
			// Floating canvas chrome (toolbar, draw overlay) is neither a window
			// nor pannable background — let it receive the click.
			if (
				event.target instanceof HTMLElement &&
				event.target.closest("[data-canvas-ui]")
			) {
				return;
			}
			const overWindow =
				event.target instanceof HTMLElement &&
				Boolean(event.target.closest("[data-canvas-window]"));
			// Shapes run their own select/drag gestures on bubble — this
			// capture-phase listener must leave their pointerdowns alone.
			const overShape =
				event.target instanceof HTMLElement &&
				Boolean(event.target.closest("[data-canvas-shape]"));
			const overBackground = !overWindow && !overShape;
			if (
				event.button === 0 &&
				event.shiftKey &&
				overBackground &&
				!spaceDown
			) {
				event.preventDefault();
				event.stopPropagation();
				const rect = viewport.getBoundingClientRect();
				marqueePointerId = event.pointerId;
				marqueeStart = {
					x: event.clientX - rect.left,
					y: event.clientY - rect.top,
				};
				viewport.setPointerCapture(event.pointerId);
				beginGesture();
				return;
			}
			const wantsPan =
				event.button === 1 ||
				(event.button === 0 && (spaceDown || overBackground));
			if (!wantsPan) return;
			event.preventDefault();
			event.stopPropagation();
			if (overBackground) {
				store.getState().setFocusedWindow(null);
				store.getState().clearSelection();
			}
			const { camera } = store.getState();
			panPointerId = event.pointerId;
			panStart = {
				x: event.clientX,
				y: event.clientY,
				cameraX: camera.x,
				cameraY: camera.y,
			};
			viewport.setPointerCapture(event.pointerId);
			beginGesture();
		};

		const handlePointerMove = (event: PointerEvent) => {
			if (event.pointerId === marqueePointerId && marqueeStart) {
				const rect = viewport.getBoundingClientRect();
				const current = {
					x: event.clientX - rect.left,
					y: event.clientY - rect.top,
				};
				const marquee = rectFromPoints(marqueeStart, current);
				const state = store.getState();
				state.setMarquee(marquee);
				const selection = rectFromPoints(
					screenToCanvas({ x: marquee.x, y: marquee.y }, state.camera),
					screenToCanvas(
						{ x: marquee.x + marquee.width, y: marquee.y + marquee.height },
						state.camera,
					),
				);
				const windowIds = Object.values(state.windows)
					.filter((window) => rectsIntersect(selection, window))
					.map((window) => window.id);
				const shapeIds = Object.values(state.shapes)
					.filter((shape) => {
						// Inflate so zero-extent bounds (straight lines) still hit.
						const bounds = getShapeBounds(shape);
						return rectsIntersect(selection, {
							x: bounds.x - 1,
							y: bounds.y - 1,
							width: bounds.width + 2,
							height: bounds.height + 2,
						});
					})
					.map((shape) => shape.id);
				state.setSelection(windowIds, shapeIds);
				return;
			}
			if (event.pointerId !== panPointerId || !panStart) return;
			const { camera } = store.getState();
			store.getState().setCamera({
				...camera,
				x: panStart.cameraX + (event.clientX - panStart.x),
				y: panStart.cameraY + (event.clientY - panStart.y),
			});
		};

		const handlePointerEnd = (event: PointerEvent) => {
			if (event.pointerId === marqueePointerId) {
				resetMarquee();
				try {
					viewport.releasePointerCapture(event.pointerId);
				} catch {
					// Capture already released.
				}
				endGesture();
				return;
			}
			if (event.pointerId !== panPointerId) return;
			panPointerId = null;
			panStart = null;
			try {
				viewport.releasePointerCapture(event.pointerId);
			} catch {
				// Capture already released.
			}
			endGesture();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.code !== "Space" || event.repeat) return;
			if (isTextEntryTarget(event.target)) return;
			// The xterm helper textarea owns space while a terminal is focused.
			if (
				event.target instanceof HTMLElement &&
				event.target.closest(".xterm")
			) {
				return;
			}
			spaceDown = true;
			viewport.style.cursor = "grab";
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			if (event.code !== "Space") return;
			spaceDown = false;
			viewport.style.cursor = "";
		};

		const handleWindowBlur = () => {
			spaceDown = false;
			viewport.style.cursor = "";
			resetMarquee();
			endGesture();
		};

		viewport.addEventListener("wheel", handleWheel, {
			passive: false,
			capture: true,
		});
		viewport.addEventListener("pointerdown", handlePointerDown, {
			capture: true,
		});
		viewport.addEventListener("pointermove", handlePointerMove);
		viewport.addEventListener("pointerup", handlePointerEnd);
		viewport.addEventListener("pointercancel", handlePointerEnd);
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);
		window.addEventListener("blur", handleWindowBlur);

		return () => {
			viewport.removeEventListener("wheel", handleWheel, { capture: true });
			viewport.removeEventListener("pointerdown", handlePointerDown, {
				capture: true,
			});
			viewport.removeEventListener("pointermove", handlePointerMove);
			viewport.removeEventListener("pointerup", handlePointerEnd);
			viewport.removeEventListener("pointercancel", handlePointerEnd);
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			window.removeEventListener("blur", handleWindowBlur);
			endGesture();
		};
	}, [store, viewportRef]);
}
