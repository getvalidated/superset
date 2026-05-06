import type { SelectV2Workspace } from "@superset/db/schema";
import { useCallback } from "react";
import { resolveHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { authClient } from "renderer/lib/auth-client";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import {
	useWorkspaceCreateFailuresStore,
	WorkspaceAlreadyExistsAtDifferentIdError,
	type WorkspaceCreateMeta,
	type WorkspacesCreateInput,
} from "./store";

export interface SubmitArgs {
	hostId: string;
	snapshot: WorkspacesCreateInput;
}

export type SubmitResult =
	| { ok: true; workspaceId: string; alreadyExists: boolean }
	| { ok: false; error: string };

export interface UseWorkspaceCreatesApi {
	submit: (args: SubmitArgs) => Promise<SubmitResult>;
	retry: (workspaceId: string) => Promise<SubmitResult | null>;
	dismiss: (workspaceId: string) => void;
}

const PLACEHOLDER_WORKSPACE_NAME = "New workspace";

function buildOptimisticRow(args: {
	snapshot: WorkspacesCreateInput;
	hostId: string;
	organizationId: string;
	currentUserId: string | null;
	startedAt: number;
}): SelectV2Workspace {
	const { snapshot, hostId, organizationId, currentUserId, startedAt } = args;
	const name = snapshot.name ?? PLACEHOLDER_WORKSPACE_NAME;
	const branch = snapshot.branch ?? snapshot.name ?? "";
	const created = new Date(startedAt);
	return {
		id: snapshot.id as string,
		organizationId,
		projectId: snapshot.projectId,
		hostId,
		name,
		branch,
		type: "worktree",
		createdByUserId: currentUserId,
		taskId: snapshot.taskId ?? null,
		createdAt: created,
		updatedAt: created,
	};
}

export function useWorkspaceCreates(): UseWorkspaceCreatesApi {
	const { machineId, activeHostUrl } = useLocalHostService();
	const { data: session } = authClient.useSession();
	const organizationId = session?.session?.activeOrganizationId;
	const currentUserId = session?.user?.id ?? null;
	const collections = useCollections();

	const dispatch = useCallback(
		async (args: SubmitArgs): Promise<SubmitResult> => {
			const workspaceId = args.snapshot.id;
			if (!workspaceId) {
				throw new Error(
					"workspaces.create requires `id` for optimistic insert",
				);
			}
			if (!organizationId) {
				const error = "No active organization";
				useWorkspaceCreateFailuresStore.getState().record(workspaceId, {
					hostId: args.hostId,
					snapshot: args.snapshot,
					error,
					failedAt: Date.now(),
				});
				return { ok: false, error };
			}
			const hostUrl = resolveHostUrl({
				hostId: args.hostId,
				machineId,
				activeHostUrl,
				organizationId,
			});
			if (!hostUrl) {
				const error = "Host service not available";
				useWorkspaceCreateFailuresStore.getState().record(workspaceId, {
					hostId: args.hostId,
					snapshot: args.snapshot,
					error,
					failedAt: Date.now(),
				});
				return { ok: false, error };
			}

			const optimisticRow = buildOptimisticRow({
				snapshot: args.snapshot,
				hostId: args.hostId,
				organizationId,
				currentUserId,
				startedAt: Date.now(),
			});
			const meta: WorkspaceCreateMeta = {
				hostUrl,
				providedName: args.snapshot.name,
				providedBranch: args.snapshot.branch,
				pr: args.snapshot.pr,
				baseBranch: args.snapshot.baseBranch,
				agents: args.snapshot.agents,
			};

			try {
				const transaction = collections.v2Workspaces.insert(optimisticRow, {
					metadata: meta as unknown as Record<string, unknown>,
				});
				await transaction.isPersisted.promise;
				useWorkspaceCreateFailuresStore.getState().clear(workspaceId);
				return { ok: true, workspaceId, alreadyExists: false };
			} catch (err) {
				if (err instanceof WorkspaceAlreadyExistsAtDifferentIdError) {
					useWorkspaceCreateFailuresStore.getState().clear(workspaceId);
					return {
						ok: true,
						workspaceId: err.canonicalWorkspaceId,
						alreadyExists: true,
					};
				}
				const error = err instanceof Error ? err.message : String(err);
				useWorkspaceCreateFailuresStore.getState().record(workspaceId, {
					hostId: args.hostId,
					snapshot: args.snapshot,
					error,
					failedAt: Date.now(),
				});
				return { ok: false, error };
			}
		},
		[machineId, activeHostUrl, organizationId, currentUserId, collections],
	);

	const submit = useCallback(
		async (args: SubmitArgs): Promise<SubmitResult> => {
			if (!args.snapshot.id) {
				throw new Error(
					"workspaces.create requires `id` for optimistic insert",
				);
			}
			return await dispatch(args);
		},
		[dispatch],
	);

	const retry = useCallback(
		async (workspaceId: string): Promise<SubmitResult | null> => {
			const failure =
				useWorkspaceCreateFailuresStore.getState().failures[workspaceId];
			if (!failure) return null;
			return await dispatch({
				hostId: failure.hostId,
				snapshot: failure.snapshot,
			});
		},
		[dispatch],
	);

	const dismiss = useCallback((workspaceId: string) => {
		useWorkspaceCreateFailuresStore.getState().clear(workspaceId);
	}, []);

	return { submit, retry, dismiss };
}
