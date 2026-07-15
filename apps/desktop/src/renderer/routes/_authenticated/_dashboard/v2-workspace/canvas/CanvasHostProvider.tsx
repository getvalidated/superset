import { buildHostRoutingKey } from "@superset/shared/host-routing";
import { WorkspaceClientProvider } from "@superset/workspace-client";
import type { ReactNode } from "react";
import { useRelayUrl } from "renderer/hooks/useRelayUrl";
import {
	getHostServiceHeaders,
	getHostServiceWsToken,
} from "renderer/lib/host-service-auth";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

/**
 * Workspace-client provider for an arbitrary host, resolved the same way
 * WorkspaceProvider does for the route workspace: the local host-service URL
 * when hostId is this machine, the relay otherwise. All canvas consumers
 * share the "global-canvas" cache key, so every window on the same host
 * reuses one client/queryClient.
 */
export function CanvasHostProvider({
	hostId,
	organizationId,
	children,
}: {
	/** Null/unknown host falls back to the local host-service. */
	hostId: string | null;
	organizationId: string;
	children: ReactNode;
}) {
	const { machineId, activeHostUrl } = useLocalHostService();
	const relayUrl = useRelayUrl();
	const hostUrl =
		!hostId || hostId === machineId
			? activeHostUrl
			: `${relayUrl}/hosts/${buildHostRoutingKey(organizationId, hostId)}`;

	if (!hostUrl) return null;

	return (
		<WorkspaceClientProvider
			cacheKey="global-canvas"
			key={hostUrl}
			hostUrl={hostUrl}
			headers={() => getHostServiceHeaders(hostUrl)}
			wsToken={() => getHostServiceWsToken(hostUrl)}
		>
			{children}
		</WorkspaceClientProvider>
	);
}
