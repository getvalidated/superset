import type { CommandCompleteEvent } from "@superset/cli-framework";
import { PostHog } from "posthog-node";
import { readConfig } from "./config";

// PostHog public project token. Same value the desktop renderer ships with;
// hardcoded here too so the CLI binary needs no extra config to fire events.
const POSTHOG_PROJECT_TOKEN = "phc_relI1yg6V5m77qT7U3JctNKULVQLh3LkGFb3PCjeQ0P";
const POSTHOG_HOST = "https://us.i.posthog.com";

const posthog = new PostHog(POSTHOG_PROJECT_TOKEN, {
	host: POSTHOG_HOST,
	flushAt: 1,
	flushInterval: 0,
});

function decodeJwtSub(token: string): string | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		// JWT body is base64url; convert to base64 then decode.
		const body = parts[1] ?? "";
		const padded = body
			.replace(/-/g, "+")
			.replace(/_/g, "/")
			.padEnd(body.length + ((4 - (body.length % 4)) % 4), "=");
		const json = JSON.parse(
			Buffer.from(padded, "base64").toString("utf-8"),
		) as { sub?: string };
		return json.sub ?? null;
	} catch {
		return null;
	}
}

function resolveDistinctId(): string | null {
	const config = readConfig();
	if (!config.auth?.accessToken) return null;
	return decodeJwtSub(config.auth.accessToken);
}

/**
 * Fires `cli_command_invoked` after every CLI command finishes. Skipped when
 * the user is unauthenticated (no JWT to derive distinct_id from). Failures
 * are swallowed — telemetry should never break a command.
 */
export async function onCommandComplete(
	event: CommandCompleteEvent,
): Promise<void> {
	const distinctId = resolveDistinctId();
	if (!distinctId) return;

	posthog.capture({
		distinctId,
		event: "cli_command_invoked",
		properties: {
			command: event.command,
			flags: event.flags,
			exit_status: event.exitStatus,
			duration_ms: event.durationMs,
			cli_version: process.env.SUPERSET_VERSION,
		},
	});

	// Bun-compiled binary exits the moment this hook returns, so flush the
	// batch synchronously to make sure the event makes it to PostHog.
	await posthog.shutdown();
}
