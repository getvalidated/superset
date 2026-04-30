import { LRUCache } from "lru-cache";
import { createApiClient } from "./api-client";

const allowedCache = new LRUCache<string, true>({
	max: 50_000,
	ttl: 5 * 60 * 1000,
});

export async function checkHostAccess(
	token: string,
	hostId: string,
	apiUrl: string,
): Promise<boolean> {
	const key = `${token}:${hostId}`;
	if (allowedCache.has(key)) return true;

	try {
		const client = createApiClient(token, apiUrl);
		const result = await client.host.checkAccess.query({ hostId });
		if (result.allowed) {
			allowedCache.set(key, true);
		}
		return result.allowed;
	} catch {
		return false;
	}
}

export async function setHostOnline(
	token: string,
	hostId: string,
	isOnline: boolean,
	apiUrl: string,
): Promise<void> {
	try {
		const client = createApiClient(token, apiUrl);
		await client.host.setOnline.mutate({ hostId, isOnline });
	} catch (error) {
		console.error(
			`[relay-cf] failed to set host ${hostId} online=${isOnline}:`,
			error,
		);
	}
}
