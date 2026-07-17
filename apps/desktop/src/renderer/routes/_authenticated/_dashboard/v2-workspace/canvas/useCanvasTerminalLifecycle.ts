import { buildHostRoutingKey } from "@superset/shared/host-routing";
import { useMemo, useRef } from "react";
import { useRelayUrl } from "renderer/hooks/useRelayUrl";
import {
	getHostServiceClientByUrl,
	type HostServiceClient,
} from "renderer/lib/host-service-client";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

/**
 * Host-session lifecycle operations for canvas terminal windows. The canvas
 * dismiss layer has no React/tRPC context of its own, so CanvasView threads
 * this through to the dismiss paths.
 */
export interface CanvasTerminalLifecycle {
	/** Whether a foreground process is running; false on any probe error. */
	probeRunning: (workspaceId: string, terminalId: string) => Promise<boolean>;
	/** Fire-and-forget host-session kill; failures are logged, never thrown. */
	killSession: (workspaceId: string, terminalId: string) => void;
}

/**
 * Imperative host-service access for canvas terminal windows, resolved per
 * window the same way CanvasHostProvider resolves its client: the local
 * host-service when the owning workspace's host is this machine, the relay
 * otherwise. Returns a stable object (reads live state through a ref) so
 * effect deps and memoized children don't churn.
 */
export function useCanvasTerminalLifecycle(): CanvasTerminalLifecycle {
	const { workspaces } = useHostWorkspaces();
	const { machineId, activeHostUrl } = useLocalHostService();
	const relayUrl = useRelayUrl();

	const contextRef = useRef({ workspaces, machineId, activeHostUrl, relayUrl });
	contextRef.current = { workspaces, machineId, activeHostUrl, relayUrl };

	return useMemo(() => {
		const resolveClient = (workspaceId: string): HostServiceClient | null => {
			const { workspaces, machineId, activeHostUrl, relayUrl } =
				contextRef.current;
			const workspace = workspaces.find((entry) => entry.id === workspaceId);
			const hostId = workspace?.hostId ?? null;
			// Unknown workspace (row already gone) falls back to the local host —
			// the common case, and remote hosts prune the window via reconcile.
			const hostUrl =
				!hostId || hostId === machineId || !workspace
					? activeHostUrl
					: `${relayUrl}/hosts/${buildHostRoutingKey(workspace.organizationId, hostId)}`;
			return hostUrl ? getHostServiceClientByUrl(hostUrl) : null;
		};

		return {
			probeRunning: async (workspaceId, terminalId) => {
				const client = resolveClient(workspaceId);
				if (!client) return false;
				try {
					const { running } = await client.terminal.hasRunningProcess.query({
						terminalId,
						workspaceId,
					});
					return running;
				} catch (error) {
					console.warn("Failed to check for running process", {
						terminalId,
						workspaceId,
						error,
					});
					return false;
				}
			},
			killSession: (workspaceId, terminalId) => {
				resolveClient(workspaceId)
					?.terminal.killSession.mutate({ terminalId, workspaceId })
					.catch((error) => {
						console.warn("Failed to kill canvas terminal session", {
							terminalId,
							workspaceId,
							error,
						});
					});
			},
		};
	}, []);
}
