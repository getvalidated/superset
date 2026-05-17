import {
	getDeploymentProfile,
	isStrictProfile,
} from "@superset/shared/deployment-profile";
import { getMissingIntegrations } from "./integration-status";

let logged = false;

export function logBootSummary(): void {
	if (logged) return;
	logged = true;

	const profile = getDeploymentProfile();
	const missing = getMissingIntegrations();

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
	for (const { label, envVar } of missing) {
		console.log(`           - ${label.padEnd(28)} ${envVar}`);
	}
}
