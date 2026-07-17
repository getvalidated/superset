import { describe, expect, test } from "bun:test";
import type { Terminal as XTerm } from "@xterm/xterm";
import { renderZoomScale, setTerminalRenderZoom } from "./terminal-render-zoom";

/**
 * Stand-in for xterm's internal CoreBrowserService: a `window` accessor pair
 * that counts sets, mirroring the real service's change-detecting setter.
 */
function makeFakeTerminal(baseWindow: Window): {
	terminal: XTerm;
	service: { window: Window };
	setCount: () => number;
} {
	let current = baseWindow;
	let sets = 0;
	const service = {
		get window() {
			return current;
		},
		set window(next: Window) {
			if (next === current) return;
			current = next;
			sets++;
		},
	};
	const terminal = {
		_core: { _coreBrowserService: service },
	} as unknown as XTerm;
	return { terminal, service, setCount: () => sets };
}

function makeBaseWindow(devicePixelRatio: number): Window {
	return {
		devicePixelRatio,
		matchMedia(query: string) {
			return { media: query, matches: false };
		},
	} as unknown as Window;
}

describe("renderZoomScale", () => {
	test("never undersamples below the native dpr", () => {
		expect(renderZoomScale(0.1)).toBe(1);
		expect(renderZoomScale(1)).toBe(1);
	});

	test("tracks zoom above 1 and caps oversampling", () => {
		expect(renderZoomScale(1.5)).toBe(1.5);
		expect(renderZoomScale(2)).toBe(2);
		expect(renderZoomScale(100)).toBe(4);
	});

	test("falls back to 1 for non-finite input", () => {
		expect(renderZoomScale(Number.NaN)).toBe(1);
		expect(renderZoomScale(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe("setTerminalRenderZoom", () => {
	test("swaps in a window reporting devicePixelRatio × zoom", () => {
		const base = makeBaseWindow(2);
		const { terminal, service } = makeFakeTerminal(base);

		setTerminalRenderZoom(terminal, 1.5);

		expect(service.window).not.toBe(base);
		expect(service.window.devicePixelRatio).toBe(3);
	});

	test("scaled window forwards other reads and binds methods to the base", () => {
		const base = makeBaseWindow(1);
		const { terminal, service } = makeFakeTerminal(base);

		setTerminalRenderZoom(terminal, 2);

		const result = service.window.matchMedia("screen and (resolution: 2dppx)");
		expect(result.media).toBe("screen and (resolution: 2dppx)");
	});

	test("reapplying the same zoom is a no-op", () => {
		const { terminal, setCount } = makeFakeTerminal(makeBaseWindow(2));

		setTerminalRenderZoom(terminal, 1.5);
		setTerminalRenderZoom(terminal, 1.5);

		expect(setCount()).toBe(1);
	});

	test("zoom at or below 1 restores the original window object", () => {
		const base = makeBaseWindow(2);
		const { terminal, service } = makeFakeTerminal(base);

		setTerminalRenderZoom(terminal, 2);
		setTerminalRenderZoom(terminal, 0.5);

		expect(service.window).toBe(base);
		expect(service.window.devicePixelRatio).toBe(2);
	});

	test("zoom ≤ 1 with nothing applied never touches the service", () => {
		const { terminal, setCount } = makeFakeTerminal(makeBaseWindow(1));

		setTerminalRenderZoom(terminal, 0.4);
		setTerminalRenderZoom(terminal, 1);

		expect(setCount()).toBe(0);
	});

	test("re-zooming wraps the original window, not the previous proxy", () => {
		const base = makeBaseWindow(2);
		const { terminal, service } = makeFakeTerminal(base);

		setTerminalRenderZoom(terminal, 1.25);
		setTerminalRenderZoom(terminal, 2);

		// 2 × base dpr 2 — a double-wrap over the 1.25 proxy would yield 5.
		expect(service.window.devicePixelRatio).toBe(4);
	});

	test("live monitor-dpr changes flow through the scaled window", () => {
		const base = makeBaseWindow(2) as Window & { devicePixelRatio: number };
		const { terminal, service } = makeFakeTerminal(base);

		setTerminalRenderZoom(terminal, 2);
		base.devicePixelRatio = 1;

		expect(service.window.devicePixelRatio).toBe(2);
	});

	test("fails soft when the internal service shape is missing", () => {
		const bare = {} as unknown as XTerm;
		expect(() => setTerminalRenderZoom(bare, 2)).not.toThrow();

		const noWindow = {
			_core: { _coreBrowserService: {} },
		} as unknown as XTerm;
		expect(() => setTerminalRenderZoom(noWindow, 2)).not.toThrow();
	});

	test("reports whether the effective dpr changed", () => {
		const { terminal } = makeFakeTerminal(makeBaseWindow(2));

		// Apply, no-op reapply, restore, no-op restore.
		expect(setTerminalRenderZoom(terminal, 1.5)).toBe(true);
		expect(setTerminalRenderZoom(terminal, 1.5)).toBe(false);
		expect(setTerminalRenderZoom(terminal, 0.5)).toBe(true);
		expect(setTerminalRenderZoom(terminal, 1)).toBe(false);
	});

	test("reports false when the service shape is missing", () => {
		expect(setTerminalRenderZoom({} as unknown as XTerm, 2)).toBe(false);
	});
});
