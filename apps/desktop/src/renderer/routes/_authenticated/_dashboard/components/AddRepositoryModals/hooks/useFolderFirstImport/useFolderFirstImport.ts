import { useCallback } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

interface FolderImportCandidate {
	id: string;
	name: string;
	slug: string;
	organizationId: string;
	organizationName: string;
}

export interface UseFolderFirstImportResult {
	start: () => Promise<void>;
}

function deriveProjectNameFromPath(path: string): string {
	const trimmed = path.trim().replace(/[\\/]+$/, "");
	const segments = trimmed.split(/[\\/]/).filter(Boolean);
	return segments[segments.length - 1] ?? "";
}

export function useFolderFirstImport(options?: {
	onSuccess?: (result: { projectId: string; repoPath: string }) => void;
	onError?: (message: string) => void;
}): UseFolderFirstImportResult {
	const { activeHostUrl } = useLocalHostService();
	const { ensureProjectInSidebar } = useDashboardSidebarState();
	const selectDirectory = electronTrpc.window.selectDirectory.useMutation();

	const reportError = useCallback(
		(message: string) => {
			options?.onError?.(message);
		},
		[options],
	);

	const start = useCallback(async () => {
		if (!activeHostUrl) {
			reportError("Host service not available");
			return;
		}

		let repoPath: string;
		try {
			const picked = await selectDirectory.mutateAsync({
				title: "Import existing folder",
			});
			if (picked.canceled || !picked.path) return;
			repoPath = picked.path;
		} catch (err) {
			reportError(err instanceof Error ? err.message : String(err));
			return;
		}

		const client = getHostServiceClientByUrl(activeHostUrl);
		let candidates: FolderImportCandidate[];
		try {
			const response = await client.project.findByPath.query({ repoPath });
			candidates = response.candidates;
		} catch (err) {
			reportError(err instanceof Error ? err.message : String(err));
			return;
		}

		const [only, ...rest] = candidates;
		if (rest.length > 0) {
			// Unreachable given single-org findByGitHubRemote + the unique
			// index on (organizationId, lower(repoCloneUrl)). Surface loudly
			// if we ever hit it — means the invariants broke.
			reportError(
				`Multiple matching projects returned (${candidates.length}) — please report this`,
			);
			return;
		}

		try {
			let result: { projectId: string; repoPath: string };
			if (only) {
				const setup = await client.project.setup.mutate({
					projectId: only.id,
					mode: { kind: "import", repoPath },
				});
				result = { projectId: only.id, repoPath: setup.repoPath };
			} else {
				const name = deriveProjectNameFromPath(repoPath);
				if (!name) {
					reportError("Could not derive a project name from the folder path");
					return;
				}
				result = await client.project.create.mutate({
					name,
					mode: { kind: "importLocal", repoPath },
				});
			}
			ensureProjectInSidebar(result.projectId);
			options?.onSuccess?.(result);
		} catch (err) {
			reportError(err instanceof Error ? err.message : String(err));
		}
	}, [
		activeHostUrl,
		ensureProjectInSidebar,
		options,
		reportError,
		selectDirectory,
	]);

	return { start };
}
