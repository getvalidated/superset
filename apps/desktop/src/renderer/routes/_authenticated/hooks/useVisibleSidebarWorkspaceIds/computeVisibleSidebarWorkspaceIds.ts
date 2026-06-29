import { getSidebarWorkspaceIsHidden } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";

export interface VisibleSidebarLocalStateWorkspace {
	id: string;
	isHidden?: boolean | null;
}

export interface VisibleSidebarMainWorkspace {
	id: string;
	hostId: string;
}

/**
 * The set of workspace ids whose ports and notifications should surface for this
 * user: every workspace known on this device (it has a local sidebar-state row),
 * plus local `main` workspaces auto-included before their row is backfilled,
 * minus the ones explicitly dismissed (hidden).
 *
 * Deliberately independent of which projects are pinned in the sidebar. A
 * workspace's ports must keep showing even while `v2SidebarProjects` is empty or
 * mid-resync, and even if its project was never pinned — gating on project
 * membership made ports vanish whenever that collection blinked. `isHidden` is
 * the single authoritative "user dismissed this" signal (a tombstone since
 * #5327), so it is the only thing we filter on.
 *
 * Coworkers' workspaces that merely share the org's Electric stream are excluded
 * for free: `v2WorkspaceLocalState` only ever holds rows for workspaces seen on
 * this device, and the auto-included `main` branch is gated on the local machine
 * id.
 *
 * Pure so the policy is unit-testable without collections or React.
 */
export function computeVisibleSidebarWorkspaceIds({
	localStateWorkspaces,
	localMainWorkspaces,
	machineId,
}: {
	localStateWorkspaces: VisibleSidebarLocalStateWorkspace[];
	localMainWorkspaces: VisibleSidebarMainWorkspace[];
	machineId: string | null;
}): Set<string> {
	const localStateWorkspaceIds = new Set(
		localStateWorkspaces.map((workspace) => workspace.id),
	);
	const visibleIds = new Set<string>();

	for (const workspace of localStateWorkspaces) {
		if (getSidebarWorkspaceIsHidden(workspace)) continue;
		visibleIds.add(workspace.id);
	}

	// Local `main` workspaces created outside the renderer (e.g. via the CLI)
	// have no local-state row until the auto-add hook backfills one. Surface them
	// immediately. A row already decides their fate above, so skip any that have
	// one — that keeps a dismissed (hidden) main from being re-added here.
	for (const workspace of localMainWorkspaces) {
		if (workspace.hostId !== machineId) continue;
		if (localStateWorkspaceIds.has(workspace.id)) continue;
		visibleIds.add(workspace.id);
	}

	return visibleIds;
}
