import { describe, expect, it } from "bun:test";
import {
	isDiffTooLarge,
	MAX_DIFF_CHAR_COUNT,
	MAX_DIFF_LINE_COUNT,
} from "./diff-size";

/** Build a text blob with the given number of newline-separated lines. */
function lines(count: number, text = "  dependency: 1.0.0"): string {
	return new Array(count).fill(text).join("\n");
}

describe("isDiffTooLarge", () => {
	it("treats a small text edit as safe to render", () => {
		expect(isDiffTooLarge(lines(10), lines(12))).toBe(false);
	});

	it("keeps a file just under both thresholds renderable", () => {
		expect(isDiffTooLarge(lines(1_000), lines(1_000))).toBe(false);
	});

	// Reproduces #5462: opening a diff for a large file (e.g. a lockfile like
	// pnpm-lock.yaml / package-lock.json) hands the full content to the
	// non-virtualized diff renderer, which lays out every line synchronously and
	// freezes the app. Such diffs must be flagged so the viewer can show a
	// placeholder instead of auto-rendering tens of thousands of lines.
	it("flags a fully-rewritten lockfile-sized diff as too large", () => {
		const original = lines(MAX_DIFF_LINE_COUNT); // ~20k lines
		const modified = lines(MAX_DIFF_LINE_COUNT); // ~20k lines => 40k combined

		expect(isDiffTooLarge(original, modified)).toBe(true);
	});

	it("flags a huge single-line file (minified bundle) as too large", () => {
		const bundle = "x".repeat(MAX_DIFF_CHAR_COUNT + 1);

		expect(isDiffTooLarge("", bundle)).toBe(true);
	});

	it("flags an added lockfile even when the original is empty", () => {
		expect(isDiffTooLarge("", lines(MAX_DIFF_LINE_COUNT + 1))).toBe(true);
	});
});
