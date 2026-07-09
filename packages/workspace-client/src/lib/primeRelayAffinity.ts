/**
 * Many WebSocket clients (browsers especially) don't transparently follow
 * fly-replay headers on the WS upgrade response — they see a non-101
 * status and fail the handshake with code 1006. To avoid that flicker, we
 * pre-flight a plain HTTP GET to the same /hosts/<id>/_whoowns endpoint
 * first. fly-replay is fully transparent for HTTP, and the GET locks fly's
 * edge affinity to the owning machine for subsequent requests, so the
 * follow-up WS upgrade lands on the right instance and gets a clean 101.
 *
 * The response also doubles as a cheap health probe: because the WS API
 * hides the upgrade's HTTP status (a 502/503 just surfaces as close code
 * 1006), the returned status is the only client-visible signal for *why* a
 * terminal/events stream can't connect. Callers use it to distinguish
 * host-offline (503) from a routing failure (200 but the WS still drops)
 * from an auth problem (401/403).
 *
 * Best-effort: if the probe fails or times out, we return null and still
 * try the WS — it just may briefly flicker during the implicit retry.
 */

const PROBE_TIMEOUT_MS = 3_000;

export interface RelayAffinityProbe {
	/** HTTP status of the `_whoowns` preflight: 200 (host tunnel present),
	 * 503 (host not connected), 401/403 (unauthorized). */
	status: number;
	/** Relay region that owns the host tunnel, when the endpoint reports it. */
	region: string | null;
}

export async function primeRelayAffinity(
	wsUrl: string,
): Promise<RelayAffinityProbe | null> {
	let url: URL;
	try {
		url = new URL(wsUrl);
	} catch {
		return null;
	}
	const match = url.pathname.match(/^(\/hosts\/[^/]+)/);
	if (!match) return null; // not a /hosts/<id>/* URL — nothing to prime

	url.pathname = `${match[1]}/_whoowns`;
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	// Keep search (token query param) so the relay can authenticate.

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		const res = await fetch(url.toString(), {
			method: "GET",
			signal: controller.signal,
			cache: "no-store",
		});
		let region: string | null = null;
		try {
			const body = (await res.json()) as { region?: unknown };
			if (typeof body?.region === "string") region = body.region;
		} catch {
			// Error statuses may carry an empty / non-JSON body.
		}
		return { status: res.status, region };
	} catch {
		// Network error / timeout — the relay itself is unreachable.
		return null;
	} finally {
		clearTimeout(timer);
	}
}
