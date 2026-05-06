import { useCallback } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export interface EnsureV2ProjectResult {
	hostUrl: string;
	projectId: string;
	repoPath: string;
	mainWorkspaceId: string | null;
}

/**
 * Ensures a v2 cloud project exists for `repoPath`, returning the resolved
 * project id (and main workspace id when the host can produce one). Used
 * during onboarding to mint the v2_projects row that v2 workspace creation
 * FK-depends on.
 *
 * Strategy:
 *  1. `findByPath` — returns either an existing local sqlite row OR a cloud
 *     match by GitHub remote.
 *  2. If a candidate exists, try `setup({ kind: "import" })` to register the
 *     local mirror against the cloud project.
 *  3. If `setup` throws (typically because the candidate is a *local-only*
 *     sqlite row from a prior `projects.openNew`, with no cloud counterpart),
 *     fall through to `project.create` which creates both the cloud project
 *     and a local sqlite row sharing the same id.
 *
 * Net effect: always returns a v2 cloud project id whose v2_workspaces FK is
 * satisfiable. Callers can pass the result straight to `useFinalizeProjectSetup`
 * to pin the project (and main workspace, if any) to the sidebar.
 */
export function useEnsureV2Project(): (args: {
	repoPath: string;
	name: string;
}) => Promise<EnsureV2ProjectResult> {
	const { activeHostUrl } = useLocalHostService();

	return useCallback(
		async ({ repoPath, name }) => {
			if (!activeHostUrl) {
				throw new Error("No active host service");
			}
			const hostService = getHostServiceClientByUrl(activeHostUrl);

			const found = await hostService.project.findByPath.query({ repoPath });
			const candidate = found.candidates[0];
			if (candidate) {
				try {
					const setupResult = await hostService.project.setup.mutate({
						projectId: candidate.id,
						mode: { kind: "import", repoPath },
					});
					return {
						hostUrl: activeHostUrl,
						projectId: candidate.id,
						repoPath: setupResult.repoPath,
						mainWorkspaceId: setupResult.mainWorkspaceId,
					};
				} catch (err) {
					// `findByPath` returns local sqlite rows even when no cloud v2
					// project exists for that id; setup → v2Project.get → NOT_FOUND.
					// Only that case is safe to fall through to create — every other
					// error (network, auth, 5xx) must propagate or repeated retries
					// would silently mint duplicate cloud projects for the same repo.
					const code = (err as { data?: { code?: string } } | null | undefined)
						?.data?.code;
					if (code !== "NOT_FOUND") {
						throw err;
					}
					console.warn(
						"[ensureV2Project] no v2 project for candidate id, falling through to create",
						err,
					);
				}
			}

			const created = await hostService.project.create.mutate({
				name,
				mode: { kind: "importLocal", repoPath },
			});
			return {
				hostUrl: activeHostUrl,
				projectId: created.projectId,
				repoPath: created.repoPath,
				mainWorkspaceId: created.mainWorkspaceId,
			};
		},
		[activeHostUrl],
	);
}
