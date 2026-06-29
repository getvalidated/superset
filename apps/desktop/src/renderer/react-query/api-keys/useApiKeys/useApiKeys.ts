import { useQuery } from "@tanstack/react-query";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";

export const apiKeysQueryKey = (organizationId: string | null | undefined) =>
	["apiKey", "list", organizationId] as const;

// Poll while the API keys screen is mounted; keys change rarely.
const REFETCH_INTERVAL_MS = 30_000;

/**
 * Org-scoped API keys, fetched via tRPC (replaces the synced collection).
 * `apiKey.list` returns display columns only — never the secret key.
 */
export function useApiKeys(organizationId: string | null | undefined) {
	const { data, isLoading } = useQuery({
		queryKey: apiKeysQueryKey(organizationId),
		enabled: !!organizationId,
		refetchInterval: REFETCH_INTERVAL_MS,
		queryFn: () =>
			apiTrpcClient.apiKey.list.query({
				organizationId: organizationId as string,
			}),
	});

	return { keys: data ?? [], isLoading };
}
