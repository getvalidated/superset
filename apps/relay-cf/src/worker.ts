import { checkHostAccess } from "./access";
import { verifyJWT } from "./auth";
import type { Env } from "./types";

export { HostTunnel } from "./host-tunnel-do";

function corsHeadersFor(request: Request): Record<string, string> {
	const origin = request.headers.get("Origin") ?? "*";
	const requestedHeaders =
		request.headers.get("Access-Control-Request-Headers") ??
		"Authorization, Content-Type";
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": requestedHeaders,
		"Access-Control-Expose-Headers": "*",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin, Access-Control-Request-Headers",
	};
}

function corsResponse(
	request: Request,
	status: number,
	body: string,
): Response {
	return new Response(body, {
		status,
		headers: {
			...corsHeadersFor(request),
			"Content-Type": "application/json",
		},
	});
}

function withCors(request: Request, response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(corsHeadersFor(request))) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
		webSocket: (response as Response & { webSocket?: WebSocket }).webSocket,
	} as ResponseInit);
}

// Map CF colo/continent → DO `locationHint`. The hint is best-effort; CF
// picks the closest available region. Fallback to `wnam` since we expect
// most early traffic from US-West.
function pickLocationHint(
	req: Request,
): DurableObjectLocationHint | undefined {
	const cf = (req as Request & { cf?: IncomingRequestCfProperties }).cf;
	const continent = cf?.continent;
	switch (continent) {
		case "NA":
			// Western vs Eastern split: heuristic on longitude when available.
			return cf?.longitude && Number(cf.longitude) < -100 ? "wnam" : "enam";
		case "EU":
			return "weur";
		case "AS":
			return "apac";
		case "OC":
			return "oc";
		case "SA":
			return "sam";
		case "AF":
			return "afr";
		default:
			return "wnam";
	}
}

function extractToken(req: Request): string | null {
	const header = req.headers.get("Authorization");
	if (header?.startsWith("Bearer ")) return header.slice(7);
	const url = new URL(req.url);
	return url.searchParams.get("token");
}

function extractHostId(url: URL): string | null {
	if (url.pathname === "/tunnel") return url.searchParams.get("hostId");
	const match = url.pathname.match(/^\/hosts\/([^/]+)/);
	return match?.[1] ?? null;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeadersFor(request),
			});
		}

		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: {
					...corsHeadersFor(request),
					"Content-Type": "application/json",
				},
			});
		}

		const token = extractToken(request);
		if (!token) return corsResponse(request, 401, '{"error":"Unauthorized"}');

		const auth = await verifyJWT(
			token,
			env.NEXT_PUBLIC_API_URL,
			env.AUTH_ISSUER ?? env.NEXT_PUBLIC_API_URL,
		);
		if (!auth) return corsResponse(request, 401, '{"error":"Unauthorized"}');

		const hostId = extractHostId(url);
		if (!hostId)
			return corsResponse(request, 400, '{"error":"Missing hostId"}');

		const allowed = await checkHostAccess(
			token,
			hostId,
			env.NEXT_PUBLIC_API_URL,
		);
		if (!allowed) return corsResponse(request, 403, '{"error":"Forbidden"}');

		const id = env.HOST_TUNNEL.idFromName(hostId);
		// `locationHint` is only consulted on first-create; existing DOs stay
		// where they were initially placed. Setting it broadly so any new
		// (hostId, region) combinations get placed close to the requester.
		const stub = env.HOST_TUNNEL.get(id, {
			locationHint: pickLocationHint(request),
		});
		const response = await stub.fetch(request);
		return withCors(request, response);
	},
} satisfies ExportedHandler<Env>;
