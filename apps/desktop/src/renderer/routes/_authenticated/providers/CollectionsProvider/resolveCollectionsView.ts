export type CollectionsView = "ready" | "loading";

/**
 * Decides what CollectionsProvider should render.
 *
 * CollectionsProvider wraps the entire authenticated app, so whatever it
 * returns is the whole window. The original logic returned `null` whenever
 * `!contextValue || isSwitching` was true, which blanked the entire UI during
 * an organization switch (see issue #5078 "Whole UI Goes Blank"). Switching
 * spans several network round-trips (setActive -> preloadCollections ->
 * refetchSession), so the window could stay blank for a noticeable, sometimes
 * indefinite, period.
 *
 * This helper never reports a "blank" outcome: the caller renders a loading
 * indicator instead of nothing, so the app is never an empty inoperable window.
 */
export function resolveCollectionsView(params: {
	/** Whether a collections context value is available (an active org resolved). */
	hasContext: boolean;
	/** Whether an organization switch is currently in flight. */
	isSwitching: boolean;
}): CollectionsView {
	// During a switch we still hold the previous org's context, but we avoid
	// rendering children against soon-to-be-stale collections. Show loading.
	if (params.isSwitching) return "loading";
	// No active organization resolved yet (session still settling).
	if (!params.hasContext) return "loading";
	return "ready";
}
