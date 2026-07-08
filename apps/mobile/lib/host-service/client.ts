import type { SelectV2Workspace } from "@superset/db/schema";
import { buildHostRoutingKey } from "@superset/shared/host-routing";
import { createTRPCClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import { getJwt } from "../auth/client";
import { env } from "../env";

export interface HostWorkspaceRow extends SelectV2Workspace {
	worktreePath: string;
	worktreeExists: boolean;
}

export interface ChangedFileStats {
	path: string;
	additions: number;
	deletions: number;
}

export interface GitStatusSnapshot {
	againstBase: ChangedFileStats[];
	staged: ChangedFileStats[];
	unstaged: ChangedFileStats[];
}

export interface DestroyWorkspaceResult {
	success: boolean;
	cloudDeleted: boolean;
	worktreeRemoved: boolean;
	branchDeleted: boolean;
	warnings: string[];
}

// Procedures mirrored from packages/host-service/src/trpc/router — the real
// AppRouter type graph is Node-flavored source that cannot compile under
// Expo's TS environment. Inputs are validated by zod on the host.
export interface HostServiceClient {
	workspace: {
		list: { query(): Promise<HostWorkspaceRow[]> };
		update: {
			mutate(input: { id: string; name?: string }): Promise<SelectV2Workspace>;
		};
	};
	workspaceCleanup: {
		destroy: {
			mutate(input: {
				workspaceId: string;
				deleteBranch?: boolean;
				force?: boolean;
			}): Promise<DestroyWorkspaceResult>;
		};
	};
	git: {
		getStatus: {
			query(input: {
				workspaceId: string;
				priority?: "foreground" | "background";
			}): Promise<GitStatusSnapshot>;
		};
	};
}

const clientCache = new Map<string, HostServiceClient>();

export function buildRelayHostUrl(
	organizationId: string,
	machineId: string,
): string {
	return `${env.EXPO_PUBLIC_RELAY_URL}/hosts/${buildHostRoutingKey(organizationId, machineId)}`;
}

export function getHostServiceClientByUrl(hostUrl: string): HostServiceClient {
	const cached = clientCache.get(hostUrl);
	if (cached) return cached;

	// biome-ignore lint/suspicious/noExplicitAny: see HostServiceClient
	const client = createTRPCClient<any>({
		links: [
			httpLink({
				url: `${hostUrl}/trpc`,
				transformer: superjson,
				headers: () => {
					const jwt = getJwt();
					return jwt ? { Authorization: `Bearer ${jwt}` } : {};
				},
			}),
		],
	}) as unknown as HostServiceClient;

	clientCache.set(hostUrl, client);
	return client;
}
