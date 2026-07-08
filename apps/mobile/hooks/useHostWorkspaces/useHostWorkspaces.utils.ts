import type { SelectV2Workspace } from "@superset/db/schema";
import {
	buildRelayHostUrl,
	type HostWorkspaceRow,
} from "@/lib/host-service/client";

export type { HostWorkspaceRow } from "@/lib/host-service/client";

export interface HostWorkspaceItem extends SelectV2Workspace {
	worktreePath?: string;
	worktreeExists?: boolean;
	/** False when the row came from the cloud fallback and the host didn't answer. */
	hostReachable: boolean;
	/** "host" = served by a host; "cloud" = Electric fallback. */
	source: "host" | "cloud";
}

export interface HostWorkspacesQueryTarget {
	machineId: string;
	organizationId: string;
	/** Null when the host is known but offline. */
	hostUrl: string | null;
}

export interface HostRowForTargets {
	organizationId: string;
	machineId: string;
	isOnline: boolean;
}

export function getHostWorkspacesQueryKey(
	target: Pick<HostWorkspacesQueryTarget, "machineId" | "hostUrl">,
) {
	return [
		"host-service",
		"workspaces",
		"list",
		target.machineId,
		target.hostUrl,
	] as const;
}

export function deriveHostWorkspacesQueryTargets(
	hosts: HostRowForTargets[],
): HostWorkspacesQueryTarget[] {
	return hosts.map((host) => ({
		machineId: host.machineId,
		organizationId: host.organizationId,
		hostUrl: host.isOnline
			? buildRelayHostUrl(host.organizationId, host.machineId)
			: null,
	}));
}

/**
 * Merge per-host results with the Electric fallback. A host that answered
 * is authoritative for its rows — cloud rows for that host are ignored (a
 * deleted row must not resurrect). Cloud rows only fill in for hosts with
 * no host-served data. The fallback is deleted in R3 along with the cloud
 * table.
 */
export function mergeHostWorkspaces({
	hostResults,
	cloudRows,
}: {
	hostResults: Array<{
		target: HostWorkspacesQueryTarget;
		rows: HostWorkspaceRow[] | undefined;
		reachable: boolean;
	}>;
	cloudRows: SelectV2Workspace[];
}): HostWorkspaceItem[] {
	const items: HostWorkspaceItem[] = [];
	const hostsWithData = new Set<string>();
	const seenIds = new Set<string>();

	for (const result of hostResults) {
		if (!result.rows) continue;
		hostsWithData.add(result.target.machineId);
		for (const row of result.rows) {
			if (seenIds.has(row.id)) continue;
			seenIds.add(row.id);
			items.push({
				...row,
				hostReachable: result.reachable,
				source: "host",
			});
		}
	}

	for (const row of cloudRows) {
		if (seenIds.has(row.id) || hostsWithData.has(row.hostId)) continue;
		seenIds.add(row.id);
		items.push({
			...row,
			hostReachable: false,
			source: "cloud",
		});
	}

	return items;
}
