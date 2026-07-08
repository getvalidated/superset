export type LocalWorkspaceForPlacement = {
	id: string;
	projectId: string;
	type: "main" | "worktree";
};

/**
 * Chooses which of this device's workspaces the sidebar reconciler should
 * place. Kept free of React so it can be unit-tested directly.
 *
 * Only `worktree` workspaces are eligible: the host creates a `main` for every
 * project on the device, so placing those would drag locally-known projects the
 * user never added into the sidebar. Main workspaces surface instead via the
 * gated `isAutoIncludedLocalMainWorkspace` path. A workspace that already has a
 * local-state row is "already placed" and skipped, so nothing the user has
 * moved, hidden, or removed is re-added.
 *
 * `attemptedWorkspaceIds` holds worktrees this session already tried to place
 * but whose local-state row never landed — most importantly because the write
 * threw (e.g. `QuotaExceededError`) and the optimistic row rolled back. Without
 * this backoff the reconciler re-selects such a worktree on every live-query
 * emission and retries forever, pegging the renderer (see issue #5496). Skipping
 * already-attempted ids makes a deterministically-failing placement a no-op
 * after the first try instead of an infinite loop.
 */
export function selectWorktreesToPlace(
	localWorkspaces: readonly LocalWorkspaceForPlacement[],
	placedWorkspaceIds: ReadonlySet<string>,
	attemptedWorkspaceIds: ReadonlySet<string> = new Set(),
): Array<{ id: string; projectId: string }> {
	return localWorkspaces
		.filter(
			(workspace) =>
				workspace.type === "worktree" &&
				!placedWorkspaceIds.has(workspace.id) &&
				!attemptedWorkspaceIds.has(workspace.id),
		)
		.map((workspace) => ({ id: workspace.id, projectId: workspace.projectId }));
}
