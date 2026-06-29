import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { computeVisibleSidebarWorkspaceIds } from "./computeVisibleSidebarWorkspaceIds";

/**
 * The set of workspace ids that surface ports and notifications for this user:
 * every workspace known on this device, minus the ones explicitly dismissed
 * (hidden). See {@link computeVisibleSidebarWorkspaceIds} for the policy and why
 * it is independent of which projects are pinned in the sidebar.
 */
export function useVisibleSidebarWorkspaceIds(): Set<string> {
	const collections = useCollections();
	const { machineId } = useLocalHostService();

	const { data: localStateWorkspaces = [] } = useLiveQuery(
		(q) =>
			q
				.from({ sidebarWorkspaces: collections.v2WorkspaceLocalState })
				.innerJoin(
					{ workspaces: collections.v2Workspaces },
					({ sidebarWorkspaces, workspaces }) =>
						eq(sidebarWorkspaces.workspaceId, workspaces.id),
				)
				.select(({ sidebarWorkspaces, workspaces }) => ({
					id: workspaces.id,
					isHidden: sidebarWorkspaces.sidebarState.isHidden,
				})),
		[collections],
	);

	const { data: localMainWorkspaces = [] } = useLiveQuery(
		(q) =>
			q
				.from({ workspaces: collections.v2Workspaces })
				.where(({ workspaces }) => eq(workspaces.type, "main"))
				.select(({ workspaces }) => ({
					id: workspaces.id,
					hostId: workspaces.hostId,
				})),
		[collections],
	);

	return useMemo(
		() =>
			computeVisibleSidebarWorkspaceIds({
				localStateWorkspaces,
				localMainWorkspaces,
				machineId,
			}),
		[localStateWorkspaces, localMainWorkspaces, machineId],
	);
}
