import { getDeploymentProfile } from "@superset/shared/deployment-profile";
import { NextResponse } from "next/server";

/**
 * Per-integration configuration status. Read from process.env so we don't
 * have to keep this in sync with the (validated) env schema — the goal here
 * is observability, not validation.
 */
const INTEGRATIONS = {
	stripe: "STRIPE_SECRET_KEY",
	resend: "RESEND_API_KEY",
	posthog: "NEXT_PUBLIC_POSTHOG_KEY",
	sentry: "NEXT_PUBLIC_SENTRY_DSN_API",
	"github-app": "GH_APP_ID",
	"github-oauth": "GH_CLIENT_ID",
	"google-oauth": "GOOGLE_CLIENT_ID",
	linear: "LINEAR_CLIENT_ID",
	slack: "SLACK_CLIENT_ID",
	freestyle: "FREESTYLE_API_KEY",
	qstash: "QSTASH_TOKEN",
	"upstash-kv": "KV_REST_API_URL",
	blob: "BLOB_READ_WRITE_TOKEN",
	anthropic: "ANTHROPIC_API_KEY",
	tavily: "TAVILY_API_KEY",
} as const;

export function GET() {
	const profile = getDeploymentProfile();
	const integrations: Record<string, "configured" | "missing"> = {};
	for (const [name, envVar] of Object.entries(INTEGRATIONS)) {
		integrations[name] = process.env[envVar] ? "configured" : "missing";
	}
	return NextResponse.json({
		ok: true,
		profile,
		integrations,
	});
}
