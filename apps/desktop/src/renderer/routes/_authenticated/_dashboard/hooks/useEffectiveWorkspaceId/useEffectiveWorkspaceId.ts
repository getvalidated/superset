import { useMemo } from "react";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { getGlobalCanvasStore } from "renderer/routes/_authenticated/_dashboard/v2-workspace/canvas";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useStore } from "zustand";

/**
 * The workspace the user is actually looking at. In canvas display mode the
 * canvas shows windows from every workspace, so the route workspace isn't
 * necessarily it — follow the focused window's owning workspace instead.
 *
 * Falls back to the route workspace when nothing is focused, the focused
 * window is org-global (search/settings, workspaceId ""), or the owning
 * workspace lives on another host — consumers query through the local host
 * client, which can't serve remote workspaces.
 */
export function useEffectiveWorkspaceId(routeWorkspaceId: string): string {
	const { machineId, activeOrganizationId } = useLocalHostService();
	const { preferences } = useV2UserPreferences();
	const { workspaces } = useHostWorkspaces();

	const canvasStore = useMemo(
		() => getGlobalCanvasStore(activeOrganizationId ?? "default"),
		[activeOrganizationId],
	);
	const focusedCanvasWorkspaceId = useStore(canvasStore, (state) =>
		state.focusedWindowId
			? state.windows[state.focusedWindowId]?.workspaceId || null
			: null,
	);

	if (preferences.displayMode !== "canvas" || !focusedCanvasWorkspaceId) {
		return routeWorkspaceId;
	}

	const focusedWorkspace = workspaces.find(
		(workspace) => workspace.id === focusedCanvasWorkspaceId,
	);
	return focusedWorkspace && focusedWorkspace.hostId === machineId
		? focusedCanvasWorkspaceId
		: routeWorkspaceId;
}
