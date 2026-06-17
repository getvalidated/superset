/**
 * Reproduction for #5292 — "Scroll is very slow only in the Claude Code pane".
 *
 * Symptom (from the issue):
 *   Scrolling with a macOS trackpad is ~3x slower in the Claude Code pane than in
 *   other terminal panes. It is isolated to the Claude pane, not system-wide, and a
 *   colleague does not see it (they presumably use a mouse wheel, not a trackpad).
 *
 * Root cause:
 *   1. The Claude Code TUI enables mouse tracking (DECSET ?1000 + ?1006). Part 1 of
 *      this test proves that with our own HeadlessEmulator: those sequences flip the
 *      terminal into mouse-tracking mode. Plain shell panes never enable this, which
 *      is exactly why only the Claude pane is affected.
 *
 *   2. Once a mouse protocol with WHEEL support is active, xterm.js stops scrolling
 *      its own viewport and instead *forwards* wheel events to the app as mouse-wheel
 *      reports (see `Viewport` constructor:
 *        `handleMouseWheel: !(type & CoreMouseEventType.WHEEL)`).
 *      The number of wheel "lines" forwarded per DOM wheel event is computed by
 *      `MouseService._consumeWheelEvent`
 *      (node_modules/@xterm/xterm@6.1.0-beta.220/src/browser/services/MouseService.ts:424).
 *      That function multiplies the scroll amount by **0.3** whenever the gesture
 *      looks like a trackpad (`Math.abs(deltaY) < 50`):
 *
 *          const isLikelyTrackpad = Math.abs(ev.deltaY) < 50;
 *          if (isLikelyTrackpad) {
 *            amount *= 0.3;
 *          }
 *
 *      Other panes are NOT in mouse mode, so their wheel events go through xterm's
 *      native smooth-scroll path (which has no such penalty) — hence "normal" speed.
 *      Mouse-wheel users escape the penalty too, because a wheel notch reports a large
 *      deltaY (>= 50), so `isLikelyTrackpad` is false.
 *
 * Part 2 of this test faithfully replicates `_consumeWheelEvent` and toggles only the
 * trackpad penalty, isolating it as the cause: a trackpad gesture forwarded to a
 * mouse-mode app scrolls ~30% of the lines it otherwise would, while a mouse-wheel
 * gesture is unaffected.
 *
 * This is reproduction-only. The fix has to live on the renderer side (e.g. a
 * compensating `xterm.attachCustomWheelEventHandler` that only kicks in while mouse
 * tracking is active) and must be verified by hand in the Electron app, so it is not
 * included here.
 */

import { beforeEach, describe, expect, test } from "bun:test";

// HeadlessEmulator touches `window` during import in some environments.
if (typeof window === "undefined") {
	(globalThis as Record<string, unknown>).window = globalThis;
}

const { HeadlessEmulator } = await import("./headless-emulator");

const CSI = "\x1b[";
// Sequences the Claude Code TUI emits to turn on mouse reporting.
const ENABLE_MOUSE_NORMAL = `${CSI}?1000h`;
const ENABLE_MOUSE_SGR = `${CSI}?1006h`;

// --- Faithful replica of xterm's MouseService._consumeWheelEvent ----------------
// Mirrors @xterm/xterm@6.1.0-beta.220/src/browser/services/MouseService.ts:424.
// `_wheelPartialScroll` is instance state on MouseService, accumulated across the
// many small wheel events that make up a single trackpad gesture, so we model it
// as a closure instead of a free variable.
const DOM_DELTA_PIXEL = 0;

function makeWheelConsumer(opts: { applyTrackpadPenalty: boolean }) {
	let wheelPartialScroll = 0;
	return function consumeWheelEvent(
		deltaY: number,
		deltaMode: number,
		deviceCellHeight: number,
		dpr: number,
	): number {
		if (deltaY === 0) return 0;
		const targetWheelEventPixels = deviceCellHeight / dpr;
		// scrollSensitivity defaults to 1 and is not overridden in TERMINAL_OPTIONS.
		let amount = deltaY * 1;

		if (deltaMode === DOM_DELTA_PIXEL) {
			amount /= targetWheelEventPixels + 0.0;

			const isLikelyTrackpad = Math.abs(deltaY) < 50;
			if (isLikelyTrackpad && opts.applyTrackpadPenalty) {
				amount *= 0.3;
			}

			wheelPartialScroll += amount;
			amount =
				Math.floor(Math.abs(wheelPartialScroll)) *
				(wheelPartialScroll > 0 ? 1 : -1);
			wheelPartialScroll %= 1;
		}
		return amount;
	};
}

/** Total lines forwarded to the app over a sequence of wheel events. */
function totalLinesForGesture(
	events: Array<{ deltaY: number; deltaMode: number }>,
	opts: { applyTrackpadPenalty: boolean },
	deviceCellHeight = 34, // ~17px CSS line height on a 2x retina display
	dpr = 2,
): number {
	const consume = makeWheelConsumer(opts);
	let total = 0;
	for (const ev of events) {
		total += Math.abs(consume(ev.deltaY, ev.deltaMode, deviceCellHeight, dpr));
	}
	return total;
}

describe("#5292 — slow scroll only in the Claude Code pane", () => {
	describe("precondition: the Claude pane enters mouse-tracking mode", () => {
		let emulator: InstanceType<typeof HeadlessEmulator>;

		beforeEach(() => {
			emulator = new HeadlessEmulator({ cols: 80, rows: 24, scrollback: 1000 });
		});

		test("Claude Code's mouse-enable sequences flip the terminal into mouse mode", async () => {
			expect(emulator.getModes().mouseTrackingNormal).toBe(false);
			expect(emulator.getModes().mouseSgr).toBe(false);

			// This is what diverts wheel events away from native scrolling and into
			// the penalized mouse-forwarding path. A plain shell pane never does this.
			await emulator.writeSync(ENABLE_MOUSE_NORMAL);
			await emulator.writeSync(ENABLE_MOUSE_SGR);

			expect(emulator.getModes().mouseTrackingNormal).toBe(true);
			expect(emulator.getModes().mouseSgr).toBe(true);
		});
	});

	describe("symptom: trackpad scrolling is throttled to 30% in mouse mode", () => {
		// A realistic macOS trackpad gesture: ~20 small high-resolution wheel events,
		// each well under the 50px "is this a trackpad?" threshold.
		const trackpadGesture = Array.from({ length: 20 }, () => ({
			deltaY: 12,
			deltaMode: DOM_DELTA_PIXEL,
		}));

		test("trackpad gesture scrolls far fewer lines once the 0.3 penalty applies", () => {
			// "actual" = Claude pane: mouse mode active, xterm applies the penalty.
			const actual = totalLinesForGesture(trackpadGesture, {
				applyTrackpadPenalty: true,
			});
			// "expected" = same algorithm without the penalty (i.e. how the user
			// expects it to feel — matching the other terminal panes).
			const expected = totalLinesForGesture(trackpadGesture, {
				applyTrackpadPenalty: false,
			});

			// Reproduces the report: scrolling is dramatically slower.
			expect(actual).toBeLessThan(expected);

			// And the slowdown is the 0.3 factor — actual is ~30% of expected.
			const ratio = actual / expected;
			expect(ratio).toBeGreaterThan(0.2);
			expect(ratio).toBeLessThan(0.45);
		});

		test("a mouse wheel (large deltaY) is NOT throttled — matches 'colleague is fine'", () => {
			// A mouse-wheel notch reports a large deltaY, so isLikelyTrackpad is false
			// and the penalty branch is never taken.
			const wheelGesture = Array.from({ length: 5 }, () => ({
				deltaY: 120,
				deltaMode: DOM_DELTA_PIXEL,
			}));

			const withPenaltyEnabled = totalLinesForGesture(wheelGesture, {
				applyTrackpadPenalty: true,
			});
			const withPenaltyDisabled = totalLinesForGesture(wheelGesture, {
				applyTrackpadPenalty: false,
			});

			expect(withPenaltyEnabled).toBe(withPenaltyDisabled);
		});
	});
});
