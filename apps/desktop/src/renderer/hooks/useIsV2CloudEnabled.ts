import { FEATURE_FLAGS } from "@superset/shared/constants";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { authClient } from "renderer/lib/auth-client";
import { useV2LocalOverrideStore } from "renderer/stores/v2-local-override";

const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Accounts created on/after this date default to v2. Older accounts default to v1
 * to preserve their existing experience until they explicitly opt in.
 */
const V2_DEFAULT_CUTOFF_MS = Date.UTC(2026, 4, 4); // 2026-05-04

function deriveDefaultOptIn(createdAt: string | Date | null | undefined) {
	if (!createdAt) return false;
	const ms =
		createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
	if (Number.isNaN(ms)) return false;
	return ms >= V2_DEFAULT_CUTOFF_MS;
}

/**
 * Returns effective v2 state: remote PostHog flag AND local opt-in.
 * Also returns the raw remote flag so the toggle can be shown conditionally.
 */
export function useIsV2CloudEnabled() {
	const remoteV2Enabled =
		useFeatureFlagEnabled(FEATURE_FLAGS.V2_CLOUD) ?? false;
	const optInV2 = useV2LocalOverrideStore((s) => s.optInV2);
	const { data: session } = authClient.useSession();

	const effectiveOptIn =
		optInV2 ?? deriveDefaultOptIn(session?.user?.createdAt);

	if (IS_DEV) {
		return {
			isV2CloudEnabled: effectiveOptIn,
			isRemoteV2Enabled: true,
		};
	}

	return {
		/** The effective value — use this wherever you previously checked the flag directly. */
		isV2CloudEnabled: remoteV2Enabled && effectiveOptIn,
		/** Whether the remote PostHog flag is on (for showing the toggle). */
		isRemoteV2Enabled: remoteV2Enabled,
	};
}
