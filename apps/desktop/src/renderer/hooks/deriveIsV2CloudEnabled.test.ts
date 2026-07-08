import { describe, expect, test } from "bun:test";
import { isV2OnlyUser } from "@superset/shared/v2-only-user";
import { deriveIsV2CloudEnabled } from "./deriveIsV2CloudEnabled";

/**
 * Reproduction for issue #5498:
 * "Silent fallback to legacy v1 dashboard when localStorage is lost."
 *
 * A pre-cutoff user (isV2OnlyUser === false) opts into v2. Their preference
 * lives ONLY in renderer localStorage (`optInV2`). If that storage is wiped,
 * `optInV2` reverts to `null` and the app drops them back to v1 with no signal.
 */
describe("deriveIsV2CloudEnabled — silent v1 fallback (#5498)", () => {
	// A pre-cutoff account: created before V2_ONLY_USER_CUTOFF (2026-05-15).
	const preCutoffCreatedAt = "2026-04-01T00:00:00.000Z";
	const isPreCutoffV2Only = isV2OnlyUser(preCutoffCreatedAt);

	test("pre-cutoff account is not a v2-only user", () => {
		expect(isPreCutoffV2Only).toBe(false);
	});

	test("pre-cutoff user who opted in sees v2", () => {
		expect(
			deriveIsV2CloudEnabled({
				optInV2: true,
				isV2OnlyUser: isPreCutoffV2Only,
				isDev: false,
			}),
		).toBe(true);
	});

	test("REPRO: losing localStorage silently drops the opted-in user back to v1", () => {
		// Before the wipe: optInV2 === true → v2 dashboard.
		const beforeWipe = deriveIsV2CloudEnabled({
			optInV2: true,
			isV2OnlyUser: isPreCutoffV2Only,
			isDev: false,
		});

		// localStorage lost (quota-recovery wipe / profile corruption / new machine)
		// → the persisted `optInV2` reverts to its default of `null`.
		const afterWipe = deriveIsV2CloudEnabled({
			optInV2: null,
			isV2OnlyUser: isPreCutoffV2Only,
			isDev: false,
		});

		// The user did not change any setting, yet v2 silently turns off.
		// This is the reported bug: "all my worktrees disappeared".
		expect(beforeWipe).toBe(true);
		expect(afterWipe).toBe(false);
		expect(afterWipe).not.toBe(beforeWipe);
	});

	test("v2-only users are NOT affected — they stay on v2 after a wipe", () => {
		// created within [cutoff, experiment start) → forced v2.
		const v2OnlyCreatedAt = "2026-05-20T00:00:00.000Z";
		expect(isV2OnlyUser(v2OnlyCreatedAt)).toBe(true);

		expect(
			deriveIsV2CloudEnabled({
				optInV2: null,
				isV2OnlyUser: true,
				isDev: false,
			}),
		).toBe(true);
	});

	test("explicit opt-out still wins over v2-only/dev defaults", () => {
		expect(
			deriveIsV2CloudEnabled({
				optInV2: false,
				isV2OnlyUser: true,
				isDev: true,
			}),
		).toBe(false);
	});
});
