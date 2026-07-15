import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { getGlobalCanvasStore } from "renderer/routes/_authenticated/_dashboard/v2-workspace/canvas";
import { useStore } from "zustand";
import { useHostWorkspaces } from "../../../../../providers/HostWorkspacesProvider";
import { useLocalHostService } from "../../../../../providers/LocalHostServiceProvider";
import { V2OpenInMenuButton } from "../V2OpenInMenuButton";

interface V2WorkspaceOpenInButtonProps {
	workspaceId: string;
}

export function V2WorkspaceOpenInButton({
	workspaceId,
}: V2WorkspaceOpenInButtonProps) {
	const { machineId, activeHostUrl, activeOrganizationId } =
		useLocalHostService();
	const { preferences } = useV2UserPreferences();

	// The canvas shows windows from every workspace, so the route workspace
	// isn't necessarily what the user is looking at — while it's displayed,
	// follow the focused window's owning workspace instead. Org-global windows
	// (search/settings, workspaceId "") and no-focus fall back to the route.
	const canvasStore = useMemo(
		() => getGlobalCanvasStore(activeOrganizationId ?? "default"),
		[activeOrganizationId],
	);
	const focusedCanvasWorkspaceId = useStore(canvasStore, (state) =>
		state.focusedWindowId
			? state.windows[state.focusedWindowId]?.workspaceId || null
			: null,
	);
	const effectiveWorkspaceId =
		preferences.displayMode === "canvas" && focusedCanvasWorkspaceId
			? focusedCanvasWorkspaceId
			: workspaceId;

	const { workspaces } = useHostWorkspaces();
	const workspace =
		workspaces.find((w) => w.id === effectiveWorkspaceId) ?? null;
	const isLocalWorkspace = workspace !== null && workspace.hostId === machineId;

	const workspaceQuery = useQuery({
		queryKey: ["v2-open-in-workspace", activeHostUrl, effectiveWorkspaceId],
		queryFn: () =>
			getHostServiceClientByUrl(activeHostUrl as string).workspace.get.query({
				id: effectiveWorkspaceId,
			}),
		enabled: !!workspace && !!activeHostUrl && isLocalWorkspace,
	});

	if (!workspace || !activeHostUrl || !isLocalWorkspace) {
		return null;
	}

	if (!workspaceQuery.data?.worktreePath) {
		return null;
	}

	return (
		<V2OpenInMenuButton
			branch={workspace.branch}
			worktreePath={workspaceQuery.data.worktreePath}
			projectId={workspace.projectId}
		/>
	);
}
