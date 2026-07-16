import { useQuery } from "@tanstack/react-query";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useEffectiveWorkspaceId } from "renderer/routes/_authenticated/_dashboard/hooks/useEffectiveWorkspaceId";
import { useHostWorkspaces } from "../../../../../providers/HostWorkspacesProvider";
import { useLocalHostService } from "../../../../../providers/LocalHostServiceProvider";
import { V2OpenInMenuButton } from "../V2OpenInMenuButton";

interface V2WorkspaceOpenInButtonProps {
	workspaceId: string;
}

export function V2WorkspaceOpenInButton({
	workspaceId,
}: V2WorkspaceOpenInButtonProps) {
	const { machineId, activeHostUrl } = useLocalHostService();
	const effectiveWorkspaceId = useEffectiveWorkspaceId(workspaceId);

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
