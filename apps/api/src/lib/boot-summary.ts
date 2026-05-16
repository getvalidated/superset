import {
	getDeploymentProfile,
	isStrictProfile,
} from "@superset/shared/deployment-profile";

/**
 * Integration name → primary env var that activates it. Listed once at API
 * boot so contributors can see what's disabled. Strict profiles fail before
 * reaching this code (env validation rejects missing keys), so this only
 * meaningfully runs in oss-dev.
 */
const INTEGRATIONS: Array<[name: string, envVar: string]> = [
	["stripe", "STRIPE_SECRET_KEY"],
	["resend (email)", "RESEND_API_KEY"],
	["posthog (telemetry)", "NEXT_PUBLIC_POSTHOG_KEY"],
	["sentry", "NEXT_PUBLIC_SENTRY_DSN_API"],
	["github-app", "GH_APP_ID"],
	["github-oauth", "GH_CLIENT_ID"],
	["google-oauth", "GOOGLE_CLIENT_ID"],
	["linear", "LINEAR_CLIENT_ID"],
	["slack", "SLACK_CLIENT_ID"],
	["freestyle", "FREESTYLE_API_KEY"],
	["qstash (jobs)", "QSTASH_TOKEN"],
	["upstash-kv (rate limit)", "KV_REST_API_URL"],
	["vercel-blob (uploads)", "BLOB_READ_WRITE_TOKEN"],
	["anthropic", "ANTHROPIC_API_KEY"],
	["tavily (search)", "TAVILY_API_KEY"],
];

let logged = false;

export function logBootSummary(): void {
	if (logged) return;
	logged = true;

	const profile = getDeploymentProfile();
	const missing = INTEGRATIONS.filter(([, k]) => !process.env[k]);

	if (isStrictProfile(profile)) {
		console.log(`[superset] profile=${profile} (strict)`);
		return;
	}

	console.log(`[superset] profile=${profile} (lenient)`);
	if (missing.length === 0) {
		console.log("[superset] all integrations configured");
		return;
	}
	console.log(
		`[superset] disabled features (set the listed env var to enable):`,
	);
	for (const [name, envVar] of missing) {
		console.log(`           - ${name.padEnd(28)} ${envVar}`);
	}
}
