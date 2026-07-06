/**
 * Guards for the non-virtualized diff renderer (`MultiFileDiff` via
 * `LightDiffViewer`).
 *
 * That renderer parses and lays out every line of a diff up front, on the
 * renderer's main thread. For very large text files — lockfiles such as
 * `pnpm-lock.yaml` / `package-lock.json`, minified bundles, generated
 * snapshots — that work blocks the thread long enough to freeze the whole app
 * (see issue #5462). Callers use `isDiffTooLarge` to detect that case and show a
 * lightweight placeholder instead of auto-rendering the diff.
 */

/**
 * Combined (original + modified) line-count ceiling above which a diff is
 * treated as too large to auto-render. A fully rewritten ~15k-line lockfile
 * lands around 30k combined lines, comfortably over this bound.
 */
export const MAX_DIFF_LINE_COUNT = 20_000;

/**
 * Combined (original + modified) character-count ceiling. Guards against
 * pathological single-line files (e.g. minified bundles) that stay under the
 * line cap while still being huge to diff and lay out.
 */
export const MAX_DIFF_CHAR_COUNT = 2_000_000;

/** Whether a diff is too large to safely render in the non-virtualized viewer. */
export function isDiffTooLarge(original: string, modified: string): boolean {
	if (original.length + modified.length > MAX_DIFF_CHAR_COUNT) {
		return true;
	}
	return countLines(original) + countLines(modified) > MAX_DIFF_LINE_COUNT;
}

/** Count lines without allocating an intermediate array via `split`. */
function countLines(value: string): number {
	if (value.length === 0) return 0;
	let count = 1;
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) === 10 /* \n */) count++;
	}
	return count;
}
