import type { Terminal as XTerm } from "@xterm/xterm";

/**
 * Rendering-only zoom compensation for a CSS scale applied by an ancestor
 * (the canvas camera transform).
 *
 * The canvas camera never changes window layout sizes, so cols/rows, the PTY,
 * and the fit addon are untouched by zooming. What does suffer is the raster:
 * xterm draws its WebGL canvas at layout px × devicePixelRatio and the
 * compositor then scales that bitmap by the camera zoom — blurry above 1×.
 *
 * xterm re-rasterizes (glyph atlas + canvas backing store, CSS size
 * unchanged) whenever its CoreBrowserService reports a new dpr — the
 * moved-to-another-monitor path. Swapping the service's `window` for a Proxy
 * whose devicePixelRatio is scaled by the camera zoom triggers exactly that
 * path: the service fires onDprChange when the window it's handed reports a
 * different dpr. Cell metrics in CSS px derive from font size, not dpr, so
 * nothing a ResizeObserver or the fit addon could see changes.
 *
 * This reaches into internals (terminal._core._coreBrowserService — the same
 * path the WebGL addon uses to obtain the service) and fails soft: if the
 * private shape changes, terminals just stay on the compositor-scaled bitmap.
 */

/** Never oversample beyond this multiple of the native dpr (atlas memory). */
const MAX_DPR_SCALE = 4;

interface CoreBrowserServiceLike {
	window: Window;
}

const appliedRenderZoom = new WeakMap<
	XTerm,
	{ baseWindow: Window; scale: number }
>();

function getCoreBrowserService(terminal: XTerm): CoreBrowserServiceLike | null {
	const core = (
		terminal as unknown as {
			_core?: { _coreBrowserService?: CoreBrowserServiceLike };
		}
	)._core;
	const service = core?._coreBrowserService;
	if (!service || typeof service.window?.devicePixelRatio !== "number") {
		return null;
	}
	return service;
}

function createDprScaledWindow(base: Window, scale: number): Window {
	return new Proxy(base, {
		get(target, prop) {
			if (prop === "devicePixelRatio") {
				// Multiply live so a real monitor-dpr change still flows through.
				return target.devicePixelRatio * scale;
			}
			const value = Reflect.get(target, prop);
			// Window methods must run with `this` as the real window or Chromium
			// throws "Illegal invocation" (matchMedia, addEventListener, rAF, …).
			return typeof value === "function"
				? (value as (...args: unknown[]) => unknown).bind(target)
				: value;
		},
		set(target, prop, value) {
			return Reflect.set(target, prop, value);
		},
	}) as Window;
}

/**
 * The dpr multiplier for a camera zoom: only oversample when zoomed in.
 * Below 1× the compositor downscale already reads fine, and re-rasterizing
 * on every zoom-out would churn the glyph atlas for no visible gain.
 */
export function renderZoomScale(zoom: number): number {
	if (!Number.isFinite(zoom)) return 1;
	return Math.min(MAX_DPR_SCALE, Math.max(1, zoom));
}

/**
 * Re-rasterize `terminal` at devicePixelRatio × renderZoomScale(zoom).
 * Idempotent per zoom value; zoom ≤ 1 restores the original window object.
 * Call after a zoom gesture settles, not per frame — each change repaints
 * the glyph atlas.
 */
export function setTerminalRenderZoom(terminal: XTerm, zoom: number): void {
	const scale = renderZoomScale(zoom);
	const applied = appliedRenderZoom.get(terminal);
	if ((applied?.scale ?? 1) === scale) return;

	const service = getCoreBrowserService(terminal);
	if (!service) return;

	const baseWindow = applied?.baseWindow ?? service.window;
	try {
		if (scale === 1) {
			service.window = baseWindow;
			appliedRenderZoom.delete(terminal);
		} else {
			service.window = createDprScaledWindow(baseWindow, scale);
			appliedRenderZoom.set(terminal, { baseWindow, scale });
		}
	} catch {
		// Setter shape changed underneath us — leave the terminal on the
		// compositor-scaled path rather than risk a broken renderer.
	}
}
