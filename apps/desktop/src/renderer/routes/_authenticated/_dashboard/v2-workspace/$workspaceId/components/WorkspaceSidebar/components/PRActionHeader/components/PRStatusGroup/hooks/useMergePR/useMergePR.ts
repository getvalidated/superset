import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import type { PullRequest } from "../../../../utils/getPRFlowState";

export type MergeMethod = "merge" | "squash" | "rebase";

interface UseMergePRArgs {
	workspaceId: string;
	/** PR being merged. May be null while the parent is still resolving
	 *  PR state; `handleMerge` is a no-op in that case. */
	pr: PullRequest | null;
	onRefresh?: () => void;
}

interface UseMergePRResult {
	handleMerge: (method: MergeMethod) => void;
	isPending: boolean;
}

/**
 * Mutation + toast lifecycle for merging a PR via the host service.
 * After a successful merge, kicks off a GitHub→host-service-DB sync
 * for this workspace so the post-merge UI state doesn't lag the next
 * background tick, then calls `onRefresh` so the local query picks up
 * the new state.
 *
 * Extracted from `PRStatusGroup` so the unified PR action pill can
 * host the merge dropdown items alongside the agent picker without
 * re-implementing the mutation. The hook stays unconditional even
 * when there's no PR yet (e.g. mid-load) — `handleMerge` no-ops.
 */
export function useMergePR({
	workspaceId,
	pr,
	onRefresh,
}: UseMergePRArgs): UseMergePRResult {
	const refreshPRMutation =
		workspaceTrpc.pullRequests.refreshByWorkspaces.useMutation();
	const mergePRMutation = workspaceTrpc.github.mergePR.useMutation({
		onMutate: () => {
			const toastId = toast.loading("Merging PR...");
			return { toastId };
		},
		onSuccess: async (_data, _variables, context) => {
			toast.success("PR merged", { id: context?.toastId });
			try {
				await refreshPRMutation.mutateAsync({ workspaceIds: [workspaceId] });
			} catch (error) {
				console.warn("Failed to refresh PR state after merge", error);
				toast.warning(
					"Merged, but couldn't refresh PR state — try again in a moment",
				);
			} finally {
				onRefresh?.();
			}
		},
		onError: (error, _variables, context) => {
			toast.error(`Merge failed: ${error.message}`, { id: context?.toastId });
		},
	});

	const handleMerge = useCallback(
		(method: MergeMethod) => {
			if (!pr) return;
			mergePRMutation.mutate({
				owner: pr.repoOwner,
				repo: pr.repoName,
				pullNumber: pr.number,
				mergeMethod: method,
			});
		},
		[mergePRMutation, pr],
	);

	return { handleMerge, isPending: mergePRMutation.isPending };
}
