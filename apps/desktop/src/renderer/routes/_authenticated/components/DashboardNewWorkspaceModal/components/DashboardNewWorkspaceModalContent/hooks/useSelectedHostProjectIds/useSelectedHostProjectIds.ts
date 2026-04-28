import { useHostTargetUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { useHostProjectIds } from "renderer/react-query/projects";
import type { WorkspaceHostTarget } from "../../../DashboardNewWorkspaceForm/components/DevicePicker/types";

/**
 * IDs of projects already set up on the selected host. Resolves the modal's
 * `WorkspaceHostTarget` to a URL and delegates to `useHostProjectIds`.
 */
export function useSelectedHostProjectIds(
	hostTarget: WorkspaceHostTarget,
): Set<string> | null {
	return useHostProjectIds(useHostTargetUrl(hostTarget));
}
