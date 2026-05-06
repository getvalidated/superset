import { useCallback } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

/**
 * Ensures a v2 cloud project exists for `repoPath`, returning the v2 project
 * id. Used during onboarding to mint the v2_projects row that v2 workspace
 * creation FK-depends on. Idempotent: if a v2 project already exists for the
 * repo (via cloud `findByPath`), reuses it and registers the local sqlite
 * mirror via `project.setup`. Otherwise creates a fresh v2 project (which
 * also writes a local sqlite row sharing the same id).
 */
export function useEnsureV2Project(): (args: {
	repoPath: string;
	name: string;
}) => Promise<string> {
	const { activeHostUrl } = useLocalHostService();

	return useCallback(
		async ({ repoPath, name }) => {
			if (!activeHostUrl) {
				throw new Error("No active host service");
			}
			const hostService = getHostServiceClientByUrl(activeHostUrl);

			const found = await hostService.project.findByPath.query({ repoPath });
			if (found.candidates.length > 0) {
				const candidate = found.candidates[0];
				if (!candidate) {
					throw new Error("findByPath returned empty candidate");
				}
				await hostService.project.setup.mutate({
					projectId: candidate.id,
					mode: { kind: "import", repoPath },
				});
				return candidate.id;
			}

			const created = await hostService.project.create.mutate({
				name,
				mode: { kind: "importLocal", repoPath },
			});
			return created.projectId;
		},
		[activeHostUrl],
	);
}
