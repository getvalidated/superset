import { app } from "electron";
import { env } from "main/env.main";
import { PostHog } from "posthog-node";
import { DEFAULT_TELEMETRY_ENABLED } from "shared/constants";
import { appendLocalEvents } from "./local-event-store";

export let posthog: PostHog | null = null;
let userId: string | null = null;

function getClient(): PostHog | null {
	if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
		return null;
	}

	if (!posthog) {
		posthog = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
			host: env.NEXT_PUBLIC_POSTHOG_HOST,
			flushAt: 1,
			flushInterval: 0,
		});
	}
	return posthog;
}

export function getPosthogClient(): PostHog | null {
	return getClient();
}

export function getUserId(): string | null {
	return userId;
}

function isTelemetryEnabled(): boolean {
	return DEFAULT_TELEMETRY_ENABLED;
}

export function setUserId(id: string | null): void {
	userId = id;
}

export function track(
	event: string,
	properties?: Record<string, unknown>,
): void {
	const fullProperties = {
		...properties,
		app_name: "desktop",
		platform: process.platform,
		desktop_version: app.getVersion(),
	};
	// Dev builds mirror every event to the local JSONL store — the dev PostHog
	// key is a placeholder, so this is where the data actually lands.
	if (env.NODE_ENV === "development") {
		try {
			appendLocalEvents("main", [
				{ event, distinct_id: userId, properties: fullProperties },
			]);
		} catch {
			// Local mirroring must never break tracking.
		}
	}
	if (!userId) return;
	if (!isTelemetryEnabled()) return;

	const client = getClient();
	if (client) {
		client.capture({
			distinctId: userId,
			event,
			properties: fullProperties,
		});
	}
}
