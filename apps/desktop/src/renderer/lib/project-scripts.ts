import { track } from "renderer/lib/analytics";
import type { electronTrpc } from "renderer/lib/electron-trpc";

type ElectronTrpcUtils = ReturnType<typeof electronTrpc.useUtils>;

export async function invalidateProjectScriptQueries(
	utils: ElectronTrpcUtils,
	projectId: string,
): Promise<void> {
	await Promise.all([
		utils.config.getConfigContent.invalidate({ projectId }),
		utils.config.shouldShowSetupCard.invalidate({ projectId }),
		utils.workspaces.getWorkspaceRunDefinition.invalidate(),
		utils.workspaces.getResolvedRunCommands.invalidate(),
	]);
}

/**
 * Fire a PostHog event when a user saves a project setup/teardown/run script.
 * Called from every updateConfig save site (v1 settings, v2 settings, and the
 * save-and-create-workspace flow) so setup-script adoption is tracked across
 * all surfaces from one place.
 */
export function trackSetupScriptConfigured(input: {
	projectId: string;
	setup?: string[];
	teardown?: string[];
	run?: string[];
}): void {
	const setup = input.setup ?? [];
	const teardown = input.teardown ?? [];
	const run = input.run ?? [];
	track("setup_script_configured", {
		project_id: input.projectId,
		setup_command_count: setup.length,
		teardown_command_count: teardown.length,
		run_command_count: run.length,
		has_setup: setup.length > 0,
		has_teardown: teardown.length > 0,
		has_run: run.length > 0,
	});
}
