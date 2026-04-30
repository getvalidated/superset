// Re-export the canonical wire-format types from @superset/shared so the
// relay-cf and host-service share a single source of truth for the protocol.
export type {
	TunnelHttpRequest,
	TunnelHttpResponse,
	TunnelPing,
	TunnelPong,
	TunnelRequest,
	TunnelResponse,
	TunnelWsClose,
	TunnelWsFrame,
	TunnelWsOpen,
} from "@superset/shared/tunnel-protocol";

export interface Env {
	NEXT_PUBLIC_API_URL: string;
	// Optional: issuer/audience used for JWT verification. Falls back to
	// NEXT_PUBLIC_API_URL when unset. Useful for local-tunnel deployments
	// where JWKS lives behind a tunnel hostname but JWTs were signed by the
	// local API with `iss=http://localhost:<port>`.
	AUTH_ISSUER?: string;
	HOST_TUNNEL: DurableObjectNamespace;
}
