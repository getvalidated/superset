/**
 * Watch the window's devicePixelRatio for changes (Electron page zoom,
 * moving the window to a monitor with a different scale factor).
 *
 * xterm quantizes its cell size to whole device pixels
 * (`css cell = floor|ceil(measured char size × dpr) / dpr`), so a dpr change
 * silently changes the cell size the fit addon sees and the renderer resizes
 * its canvas under a grid that was fitted with the old metrics. Terminals
 * must refit when this fires — a ResizeObserver alone misses dpr changes
 * that don't alter layout size (monitor moves), and can race ahead of
 * xterm's own dpr handling on page zoom.
 *
 * Uses the re-arm pattern (same as useZoomFactor): a `(resolution: Xdppx)`
 * media query fires exactly once when the dpr moves off X, then re-arms at
 * the new value.
 */
export function watchDevicePixelRatio(onChange: () => void): () => void {
	let media: MediaQueryList | null = null;
	let disposed = false;

	const handleChange = () => {
		if (disposed) return;
		arm();
		onChange();
	};

	const arm = () => {
		media?.removeEventListener("change", handleChange);
		media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		media.addEventListener("change", handleChange);
	};

	arm();

	return () => {
		disposed = true;
		media?.removeEventListener("change", handleChange);
		media = null;
	};
}
