import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";

/** Workspace-relative path where the per-project PR prompt lives. */
export const PR_PROMPT_RELATIVE_PATH = ".superset/pr-prompt.md";

interface UseProjectPRPromptResult {
	/** Absolute path to the prompt file, once the worktree path resolves.
	 *  Null while the workspace query is loading. */
	absolutePath: string | null;
	/** File contents. `null` when the file doesn't exist; `""` for an empty
	 *  file. Undefined while loading. */
	content: string | null | undefined;
	isLoading: boolean;
	exists: boolean;
	revision: string | null;
	/** Writes content. Creates the file if needed. Refetches the read query
	 *  on success so consumers see the new value. */
	save: (next: string) => Promise<void>;
	isSaving: boolean;
	/** Imperatively re-read the file. Useful right before a PR dispatch to
	 *  pick up any changes the user made externally. */
	refetch: () => Promise<void>;
}

/**
 * Reads + writes `.superset/pr-prompt.md` for a workspace. The file is
 * optional — when absent or empty, the PR dispatch behaves exactly as if
 * the feature didn't exist. When present, the dispatch appends its
 * contents to the `pr-context.md` payload as a "Project guidelines"
 * section that the slash command honours.
 *
 * Uses electronTrpc.filesystem (absolute-path API). Worktree resolution
 * is done here so consumers can pass just a workspaceId.
 */
export function useProjectPRPrompt(
	workspaceId: string,
): UseProjectPRPromptResult {
	const workspaceQuery = workspaceTrpc.workspace.get.useQuery(
		{ id: workspaceId },
		{ staleTime: Number.POSITIVE_INFINITY },
	);
	const worktreePath = workspaceQuery.data?.worktreePath;
	const absolutePath = useMemo(
		() =>
			worktreePath
				? toAbsoluteWorkspacePath(worktreePath, PR_PROMPT_RELATIVE_PATH)
				: null,
		[worktreePath],
	);

	const fileQuery = electronTrpc.filesystem.readFile.useQuery(
		{
			workspaceId,
			absolutePath: absolutePath ?? "",
			encoding: "utf8",
		},
		{
			// Enabled only once we know where to read from. The query catches
			// "file not found" and returns it as a rejected promise; we mask
			// it as `content: null` via the `select` below.
			enabled: Boolean(absolutePath),
			retry: false,
			// Don't surface "file does not exist" as a console-noisy error —
			// that's the normal state when the user hasn't set a prompt.
			throwOnError: false,
			staleTime: 30_000,
		},
	);

	const writeMutation = electronTrpc.filesystem.writeFile.useMutation();
	const utils = electronTrpc.useUtils();

	const result = fileQuery.data;
	const exists = Boolean(result);
	const content: string | null | undefined = fileQuery.isLoading
		? undefined
		: result && result.kind === "text"
			? result.content
			: result
				? null // binary file — treat as absent for prompt purposes
				: null;
	const revision = result?.revision ?? null;

	const save = useCallback(
		async (next: string) => {
			if (!absolutePath) return;
			try {
				await writeMutation.mutateAsync({
					workspaceId,
					absolutePath,
					content: next,
					encoding: "utf8",
					options: { create: true, overwrite: true },
				});
				await utils.filesystem.readFile.invalidate({
					workspaceId,
					absolutePath,
					encoding: "utf8",
				});
			} catch (error) {
				const description =
					error instanceof Error ? error.message : "Unknown error";
				toast.error("Couldn't save PR prompt", { description });
				throw error;
			}
		},
		[absolutePath, workspaceId, writeMutation, utils.filesystem.readFile],
	);

	const refetch = useCallback(async () => {
		if (!absolutePath) return;
		await fileQuery.refetch();
	}, [absolutePath, fileQuery]);

	return {
		absolutePath,
		content,
		isLoading: fileQuery.isLoading || workspaceQuery.isLoading,
		exists,
		revision,
		save,
		isSaving: writeMutation.isPending,
		refetch,
	};
}
