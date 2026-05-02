import { createHash } from "node:crypto";

// PostHog public project token. Same value the desktop renderer + CLI ship with.
// Hardcoded so SDK consumers don't need to configure anything to fire events.
const POSTHOG_PROJECT_TOKEN = "phc_relI1yg6V5m77qT7U3JctNKULVQLh3LkGFb3PCjeQ0P";
const POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * SDK distinct_id is a sha256 prefix of the API key — anonymous but stable
 * per credential, so we can answer "which API keys are calling the SDK" and
 * join to the user/organization in the cloud DB if needed. We deliberately
 * don't decode the JWT here because non-host requests never mint one, and
 * eagerly minting just for telemetry would add latency to every SDK init.
 */
export function distinctIdForApiKey(apiKey: string): string {
	return `sdk_${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

export interface SdkCallEvent {
	method: string;
	kind: "mutation" | "query" | "hostMutation" | "hostQuery";
	status: "success" | "error";
	durationMs: number;
	sdkVersion: string;
}

export function captureSdkCall(distinctId: string, event: SdkCallEvent): void {
	// Fire-and-forget. Errors are silently dropped so telemetry can never
	// surface in caller code.
	fetch(`${POSTHOG_HOST}/capture/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			api_key: POSTHOG_PROJECT_TOKEN,
			event: "sdk_method_called",
			distinct_id: distinctId,
			properties: {
				method: event.method,
				kind: event.kind,
				status: event.status,
				duration_ms: event.durationMs,
				sdk_version: event.sdkVersion,
			},
			timestamp: new Date().toISOString(),
		}),
	}).catch(() => {
		// Swallow — telemetry must not break the SDK.
	});
}
