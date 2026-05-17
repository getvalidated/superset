export const INTEGRATIONS = [
	{ key: "stripe", label: "stripe", envVar: "STRIPE_SECRET_KEY" },
	{ key: "resend", label: "resend (email)", envVar: "RESEND_API_KEY" },
	{
		key: "posthog",
		label: "posthog (telemetry)",
		envVar: "NEXT_PUBLIC_POSTHOG_KEY",
	},
	{ key: "sentry", label: "sentry", envVar: "NEXT_PUBLIC_SENTRY_DSN_API" },
	{ key: "github-app", label: "github-app", envVar: "GH_APP_ID" },
	{ key: "github-oauth", label: "github-oauth", envVar: "GH_CLIENT_ID" },
	{ key: "google-oauth", label: "google-oauth", envVar: "GOOGLE_CLIENT_ID" },
	{ key: "linear", label: "linear", envVar: "LINEAR_CLIENT_ID" },
	{ key: "slack", label: "slack", envVar: "SLACK_CLIENT_ID" },
	{ key: "freestyle", label: "freestyle", envVar: "FREESTYLE_API_KEY" },
	{ key: "qstash", label: "qstash (jobs)", envVar: "QSTASH_TOKEN" },
	{
		key: "upstash-kv",
		label: "upstash-kv (rate limit)",
		envVar: "KV_REST_API_URL",
	},
	{
		key: "blob",
		label: "vercel-blob (uploads)",
		envVar: "BLOB_READ_WRITE_TOKEN",
	},
	{ key: "anthropic", label: "anthropic", envVar: "ANTHROPIC_API_KEY" },
	{ key: "tavily", label: "tavily (search)", envVar: "TAVILY_API_KEY" },
] as const;

export type IntegrationKey = (typeof INTEGRATIONS)[number]["key"];
export type Integration = (typeof INTEGRATIONS)[number];
export type IntegrationStatus = "configured" | "missing";

export function getIntegrationStatuses(
	envSource: Record<string, string | undefined> = process.env,
): Record<IntegrationKey, IntegrationStatus> {
	return Object.fromEntries(
		INTEGRATIONS.map(({ key, envVar }) => [
			key,
			envSource[envVar] ? "configured" : "missing",
		]),
	) as Record<IntegrationKey, IntegrationStatus>;
}

export function getMissingIntegrations(
	envSource: Record<string, string | undefined> = process.env,
): Integration[] {
	return INTEGRATIONS.filter(({ envVar }) => !envSource[envVar]);
}
