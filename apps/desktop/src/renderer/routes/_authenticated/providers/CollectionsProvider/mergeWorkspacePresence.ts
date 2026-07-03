import type { SelectV2Workspace } from "@superset/db/schema";

/** updateLocal patch adopting a cloud identity edit into the local row. */
export interface WorkspaceIdentityPatch {
	id: string;
	name?: string;
	taskId?: string | null;
}

interface MergeWorkspacePresenceArgs {
	/** This machine's workspaces from the local host-service (authoritative). */
	local: SelectV2Workspace[];
	/** All org workspaces from cloud presence. */
	cloud: SelectV2Workspace[];
	organizationId: string;
	localMachineId: string | null;
}

interface MergeWorkspacePresenceResult {
	rows: SelectV2Workspace[];
	/** Cloud identity edits newer than the local row, to persist via updateLocal. */
	patches: WorkspaceIdentityPatch[];
}

// Local rows win for existence; cloud contributes other hosts' presence.
// For rows that exist on both sides, identity fields (name/taskId) follow
// last-write-wins on updatedAt so renames made from another machine reach
// this host instead of being silently reverted by its next local edit.
// Branch is excluded: the local row must track the actual git branch.
export function mergeWorkspacePresence({
	local,
	cloud,
	organizationId,
	localMachineId,
}: MergeWorkspacePresenceArgs): MergeWorkspacePresenceResult {
	const localForOrg = local.filter((w) => w.organizationId === organizationId);
	const cloudForOrg = cloud.filter((w) => w.organizationId === organizationId);
	const cloudById = new Map(cloudForOrg.map((w) => [w.id, w]));
	const localIds = new Set(localForOrg.map((w) => w.id));

	const patches: WorkspaceIdentityPatch[] = [];
	const rows = localForOrg.map((localRow) => {
		const cloudRow = cloudById.get(localRow.id);
		if (!cloudRow) return localRow;
		const cloudNewer =
			cloudRow.updatedAt.getTime() > localRow.updatedAt.getTime();
		const nameDiffers = cloudRow.name !== localRow.name;
		const taskDiffers = (cloudRow.taskId ?? null) !== (localRow.taskId ?? null);
		if (!cloudNewer || (!nameDiffers && !taskDiffers)) return localRow;
		const patch: WorkspaceIdentityPatch = { id: localRow.id };
		if (nameDiffers) patch.name = cloudRow.name;
		if (taskDiffers) patch.taskId = cloudRow.taskId ?? null;
		patches.push(patch);
		return {
			...localRow,
			name: cloudRow.name,
			taskId: cloudRow.taskId ?? null,
		};
	});

	// hostId === localMachineId but no local row means stale cloud presence
	// (e.g. deleted locally while the cloud delete failed) — don't resurrect.
	const remote = cloudForOrg.filter(
		(w) => w.hostId !== localMachineId && !localIds.has(w.id),
	);
	return { rows: [...rows, ...remote], patches };
}
