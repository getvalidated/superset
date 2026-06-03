import { describe, expect, test } from "bun:test";
import { resolveCollectionsView } from "./resolveCollectionsView";

/**
 * Regression test for #5078 — "Whole UI Goes Blank".
 *
 * CollectionsProvider wraps the entire authenticated app. The original gating
 * branch
 *
 *     if (!contextValue || isSwitching) return null;
 *
 * unmounted EVERYTHING (a blank window) whenever the user switched
 * organizations, because `switchOrganization` sets `isSwitching = true` across
 * several network round-trips (setActive -> preloadCollections ->
 * refetchSession). That matches the report exactly: "sometimes superset just
 * goes blank. a reload from the menu resolves it" — reloading re-runs the
 * provider with `isSwitching = false`, so the blank disappears.
 */
describe("CollectionsProvider blank-screen regression (#5078)", () => {
	// The exact original inline predicate, kept to document the bug it caused.
	const legacyRendersBlank = (hasContext: boolean, isSwitching: boolean) =>
		!hasContext || isSwitching;

	test("reproduces the bug: legacy logic blanked the whole UI during an org switch", () => {
		// hasContext is true — we still hold the previous org's collections — yet
		// the old code returned null, blanking the entire authenticated window.
		expect(legacyRendersBlank(true, true)).toBe(true);
	});

	test("fix: shows a loading state instead of blanking while switching orgs", () => {
		expect(
			resolveCollectionsView({ hasContext: true, isSwitching: true }),
		).toBe("loading");
	});

	test("renders content once collections are ready and not switching", () => {
		expect(
			resolveCollectionsView({ hasContext: true, isSwitching: false }),
		).toBe("ready");
	});

	test("shows loading (never blank) while the active org is still resolving", () => {
		expect(
			resolveCollectionsView({ hasContext: false, isSwitching: false }),
		).toBe("loading");
	});

	test("never reports a state that would render a blank window", () => {
		for (const hasContext of [true, false]) {
			for (const isSwitching of [true, false]) {
				const view = resolveCollectionsView({ hasContext, isSwitching });
				expect(["ready", "loading"]).toContain(view);
			}
		}
	});
});
