# Relay rewrite on Cloudflare Workers + Durable Objects

## Context

The current relay (`apps/relay`) is a Hono+WS service on Fly, single machine in `sjc`, in-memory tunnel directory (`Map<hostId, TunnelState>` at `apps/relay/src/tunnel.ts:30`). To scale globally on Fly we'd need to build a Redis-backed directory, fly-replay routing, a `_whoowns` WS pre-flight, region-aware fallback, SIGTERM drain, and reconciliation loops — all of which are coordination machinery around the fundamental thing: "one persistent owner per hostId, globally addressable."

Cloudflare Durable Objects are exactly that primitive. Each hostId becomes one DO globally singleton; the Worker layer routes by name. The directory, the replay routing, the pre-flight, the boot cleanup, and the region sizing all collapse into the platform.

The repo already runs one CF Worker (`apps/electric-proxy`, `apps/electric-proxy/wrangler.jsonc`, deployed on `wrangler ^4.14.4`) using the same JWKS-based JWT verification pattern. We have the operational muscle.

User decisions captured during planning:
- Rewrite on CF + DO rather than build out the Fly directory.
- Keep streaming protocol changes in scope (Phase 3 from the old plan) — the wire format is changing either way.
- Initial regions: implicit — Workers run at every CF PoP automatically; no region config to maintain.

## Approach

1. **New app `apps/relay-cf`** mirroring `apps/electric-proxy`'s shape: Worker entry + Durable Object class, deployed via `wrangler`.
2. **Worker** = stateless edge handler. Verifies JWT, runs the `host.checkAccess` LRU check, looks up the DO by `idFromName(hostId)`, forwards via `stub.fetch(req)`. Same pattern as `apps/electric-proxy/src/index.ts`.
3. **`HostTunnel` Durable Object** = one per hostId. Holds the host-side WS via the hibernatable WebSocket API (`state.acceptWebSocket`), multiplexes client HTTP/WS over it, calls `host.setOnline` via tRPC on register/unregister.
4. **Chunked tunnel protocol** (replaces today's one-shot `http`/`http:response`): `http:start` + `http:chunk*` + `http:end` and matching response frames. Required for SSE, tRPC subscriptions, and any large body.
5. **Cutover** by flipping `RELAY_URL` from `relay.superset.sh` (Fly) to `relay-cf.superset.sh` (CF). Single env-var change; A/B-able per-user via a PostHog flag during canary.

## Files to create

```
apps/relay-cf/
├── wrangler.jsonc                # DO bindings, routes, env, compatibility_date
├── package.json                  # @cloudflare/workers-types, wrangler, jose, @upstash/redis (NOT NEEDED), @superset/trpc, @superset/shared, lru-cache, zod
├── tsconfig.json                 # extends @superset/typescript, lib: webworker
├── src/
│   ├── worker.ts                 # entry: routes /tunnel, /hosts/:hostId/* to DO
│   ├── auth.ts                   # COPY of apps/relay/src/auth.ts (already Workers-compatible)
│   ├── access.ts                 # COPY of apps/relay/src/access.ts (lru-cache works in Workers)
│   ├── api-client.ts             # COPY of apps/relay/src/api-client.ts (tRPC over fetch)
│   ├── env.ts                    # Workers env binding schema (no @t3-oss/env-core; use zod against env arg)
│   ├── host-tunnel-do.ts         # the HostTunnel Durable Object class
│   ├── streaming.ts              # chunk frame helpers (encode/decode, base64)
│   └── types.ts                  # wire format types (mirrored in host-service)
```

Three of those (`auth.ts`, `access.ts`, `api-client.ts`) are direct copies — same code already runs in `apps/electric-proxy`. Verified.

## Files to modify

### `packages/host-service/src/tunnel/tunnel-client.ts`
- Streaming send: handle inbound `http:start`/`http:chunk`/`http:end` from relay, open `fetch` to local HTTP server with a streaming `ReadableStream` body.
- Streaming receive: instead of today's `await response.text()`, pipe `response.body` chunks back as `http:response:chunk` frames.
- Close-code handling at `packages/host-service/src/tunnel/tunnel-client.ts:70-76`: if `event.code === 4001`, skip backoff and reconnect on next tick.
- Proactive ping every 15s; consider any 45s message-silence as dead and reconnect (today only relay pings, dead-server detection is up to ~90s).
- Backwards-compat window: still accept legacy one-shot `http` from relay during transition.

### `packages/host-service/src/tunnel/types.ts`
- Add: `http:start`, `http:chunk`, `http:end`, `http:response:start`, `http:response:chunk`, `http:response:end`.
- Keep legacy `http`/`http:response` for compat window; remove after host-client rollout settles.

### `packages/cli/src/lib/env.ts:8`
- Update default fallback after cutover, or leave pointing at the existing domain (we re-CNAME `relay.superset.sh` to the CF deployment when ready).

### `packages/trpc/src/router/host/host.ts:142`
- No changes needed — DO calls the existing `host.setOnline` mutation via tRPC over fetch with the host's JWT, same pattern the current Fly relay uses (`apps/relay/src/tunnel.ts:65`, `:85-86`).

### Top-level `package.json` / `turbo.json`
- Add `apps/relay-cf` to workspace globs (auto-discovered if `apps/*` is already a workspace pattern — likely yes).
- Add a `deploy:relay-cf` task that runs `wrangler deploy` from the app directory.

## Worker entry (sketch)

```ts
// apps/relay-cf/src/worker.ts
import { verifyJWT } from "./auth";
import { checkHostAccess } from "./access";

export { HostTunnel } from "./host-tunnel-do";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");

    const token = extractToken(req);
    if (!token) return new Response("Unauthorized", { status: 401 });
    const auth = await verifyJWT(token, env.NEXT_PUBLIC_API_URL);
    if (!auth) return new Response("Unauthorized", { status: 401 });

    const hostId =
      url.pathname === "/tunnel"
        ? url.searchParams.get("hostId")
        : url.pathname.match(/^\/hosts\/([^/]+)/)?.[1];
    if (!hostId) return new Response("Missing hostId", { status: 400 });

    const allowed = await checkHostAccess(token, hostId, env);
    if (!allowed) return new Response("Forbidden", { status: 403 });

    const stub = env.HOST_TUNNEL.get(env.HOST_TUNNEL.idFromName(hostId));
    return stub.fetch(req);
  },
};
```

`extractToken` mirrors `apps/relay/src/index.ts:31-40` (Authorization header or `?token=` query param).

## HostTunnel Durable Object (sketch)

```ts
// apps/relay-cf/src/host-tunnel-do.ts
export class HostTunnel implements DurableObject {
  private hostWs: WebSocket | null = null;
  private pending = new Map<string, WritableStreamDefaultWriter<Uint8Array>>();
  private pendingHead = new Map<string, (head: { status: number; headers: Record<string,string> }) => void>();
  private clientChannels = new Map<string, WebSocket>();
  private hostId: string | null = null;

  constructor(private state: DurableObjectState, private env: Env) {
    // re-attach hibernated host WS on wakeup
    const [host] = this.state.getWebSockets("host");
    if (host) {
      this.hostWs = host;
      this.hostId = host.deserializeAttachment()?.hostId ?? null;
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/tunnel") return this.registerHost(req);

    const subpath = url.pathname.replace(/^\/hosts\/[^/]+/, "") || "/";
    if (req.headers.get("Upgrade") === "websocket")
      return this.openClientWs(req, subpath);
    return this.proxyHttp(req, subpath);
  }

  private async registerHost(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const hostId = url.searchParams.get("hostId")!;
    const token = extractToken(req)!;

    if (this.hostWs) this.hostWs.close(1000, "replaced");  // last-write-wins

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.state.acceptWebSocket(server, ["host"]);
    server.serializeAttachment({ hostId, token });
    this.hostWs = server;
    this.hostId = hostId;

    // setOnline true via tRPC, fire-and-forget
    void setHostOnline(this.env, token, hostId, true);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async proxyHttp(req: Request, subpath: string): Promise<Response> {
    if (!this.hostWs) return new Response("Host not connected", { status: 503 });

    const id = crypto.randomUUID();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    this.pending.set(id, writable.getWriter());

    const headPromise = new Promise<{ status: number; headers: Record<string,string> }>(
      (r) => this.pendingHead.set(id, r)
    );

    this.send({ type: "http:start", id, method: req.method, path: subpath, headers: headersToObj(req.headers) });
    if (req.body) {
      const reader = req.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.send({ type: "http:chunk", id, data: b64encode(value) });
      }
    }
    this.send({ type: "http:end", id });

    const { status, headers } = await headPromise;
    return new Response(readable, { status, headers });
  }

  // hibernatable WS callbacks — Workers calls these even from a cold isolate
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    if (msg.type === "pong") return;
    if (msg.type === "http:response:start") {
      this.pendingHead.get(msg.id)?.({ status: msg.status, headers: msg.headers });
      this.pendingHead.delete(msg.id);
    }
    if (msg.type === "http:response:chunk") {
      await this.pending.get(msg.id)?.write(b64decode(msg.data));
    }
    if (msg.type === "http:response:end") {
      await this.pending.get(msg.id)?.close();
      this.pending.delete(msg.id);
    }
    if (msg.type === "ws:frame") {
      this.clientChannels.get(msg.id)?.send(msg.data);
    }
    if (msg.type === "ws:close") {
      const ch = this.clientChannels.get(msg.id);
      if (ch) { this.clientChannels.delete(msg.id); ch.close(msg.code ?? 1000); }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    if (ws === this.hostWs) {
      this.hostWs = null;
      // fail all pending, close all client channels, setOnline false
      for (const w of this.pending.values()) await w.abort("tunnel closed");
      this.pending.clear();
      this.pendingHead.clear();
      for (const ch of this.clientChannels.values()) ch.close(1011, "tunnel closed");
      this.clientChannels.clear();
      const att = ws.deserializeAttachment();
      if (att) void setHostOnline(this.env, att.token, att.hostId, false);
    } else {
      // a client channel closed; tell the host
      for (const [id, channel] of this.clientChannels) {
        if (channel === ws) {
          this.clientChannels.delete(id);
          this.send({ type: "ws:close", id, code });
          return;
        }
      }
    }
  }

  private send(msg: unknown): void {
    if (this.hostWs?.readyState === WebSocket.READY_STATE_OPEN)
      this.hostWs.send(JSON.stringify(msg));
  }
}
```

`openClientWs` mirrors today's `apps/relay/src/index.ts:144-174` — accept the client WS, store in `clientChannels`, send `ws:open` to host, route inbound frames as `ws:frame`. Hibernatable accept on the client side too if we want zero-cost idle channels.

## Wire format (chunked)

Host-bound (DO → host):
```
{ type: "http:start",  id, method, path, headers }
{ type: "http:chunk",  id, data: <base64> }
{ type: "http:end",    id }
{ type: "ws:open",     id, path, query? }
{ type: "ws:frame",    id, data }
{ type: "ws:close",    id, code? }
{ type: "ping" }
```

Relay-bound (host → DO):
```
{ type: "http:response:start", id, status, headers }
{ type: "http:response:chunk", id, data: <base64> }
{ type: "http:response:end",   id }
{ type: "ws:frame",            id, data }
{ type: "ws:close",            id, code? }
{ type: "pong" }
```

Compat: DO accepts legacy one-shot `http`/`http:response` during host-client rollout. Remove ~30 days after host-client min-version is deployed.

## Auth flow on Workers

Confirmed by exploration — all three auth pieces port directly:

- `verifyJWT(token, apiUrl)` (`apps/relay/src/auth.ts:1-41`): jose `createRemoteJWKSet` against `${apiUrl}/api/auth/jwks`, local verify with `iss/aud=apiUrl`. Already runs in `apps/electric-proxy/src/auth.ts`. Module-level JWKS singleton survives within a Worker isolate; cold start re-fetches.
- `checkHostAccess(token, hostId)` (`apps/relay/src/access.ts:1-26`): `lru-cache` (max 50k, TTL 5min, allow-only) wrapping `host.checkAccess` tRPC call. `lru-cache` is pure JS, runs fine in Workers. First request per cold isolate pays one tRPC round trip.
- `host.setOnline` (`packages/trpc/src/router/host/host.ts:142-181`): JWT-protected mutation, single host write. DO calls it via tRPC over fetch with the host's stored JWT — same as `apps/relay/src/tunnel.ts:65,85-86` does today.

Cold-isolate cost: one JWKS fetch + one `checkAccess` call. Both <50ms. Acceptable.

## `wrangler.jsonc` (sketch)

```jsonc
{
  "name": "superset-relay",
  "main": "src/worker.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "relay-cf.superset.sh/*", "zone_name": "superset.sh" }],
  "durable_objects": {
    "bindings": [{ "name": "HOST_TUNNEL", "class_name": "HostTunnel" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["HostTunnel"] }],
  "vars": {
    "NEXT_PUBLIC_API_URL": "https://api.superset.sh"
  }
}
```

`new_sqlite_classes` (vs `new_classes`) gives us SQLite-backed DOs which are now the default — ~5× cheaper on storage and required for new DOs as of Cloudflare's 2025 pricing change.

## Cutover plan

Each step is independently revertible.

1. **Build `apps/relay-cf` end-to-end**, deploy to `relay-cf.superset.sh`. No production traffic. Verify via direct curl + a hand-pointed dev desktop. ~1 week.
2. **Land streaming protocol on host-service** (`packages/host-service/src/tunnel/*`). Ship in next desktop release. The current Fly relay continues to accept legacy one-shot frames; new host-clients still talk to it fine.
3. **Internal canary**: add a `RELAY_URL_OVERRIDE` field on `users` (or a PostHog feature flag we read at host-service startup). Flip 5–10 internal users to `relay-cf.superset.sh`. Watch CF dashboard metrics + Sentry for one week.
4. **Org-level canary**: extend the override to organization scope; bring up 2–3 friendly orgs.
5. **Default flip**: change the default `RELAY_URL` in `packages/cli/src/lib/env.ts:8` and `apps/desktop` env defaults to point at the CF domain. Push a host-service release. Watch for one more week.
6. **CNAME swap**: re-point `relay.superset.sh` DNS to the CF deployment so older host-service versions also migrate. Drop the override mechanism.
7. **Decommission Fly**: `fly app destroy superset-relay`. Delete `apps/relay/`. Delete `apps/relay/plans/20260420-relay-hardening.md`.

Rollback at any step: flip the override or DNS back. The Fly relay stays running until step 7.

## Cost shape

Sized for 1k concurrent hosts, ~100 client RPS aggregate (current ballpark scale):

- Workers requests (Worker entry per client req + per host WS message round): ~780M/mo × $0.30/M ≈ **$234**
- DO requests (Worker→DO sub-requests, similar order): ≈ **$234**
- DO duration (hibernatable WS — only billed during active CPU): rough $10–50 depending on traffic shape
- DO storage: ~$0
- **Total ~$500/mo at projected steady load**

Compare Fly: ~$108/mo idle baseline (3 regions × 1 machine) + traffic, ~$300–400/mo all-in at the same load.

The key shape difference: **CF baseline is ~$0**; Fly baseline is fixed regardless of traffic. CF wins at <50% utilization; Fly wins at >80% steady-state. Cost is also unit-priced (per-request, per-CPU-ms) rather than capacity-priced (per-machine), which makes finance modeling easier.

These are projections, not measurements — re-check on real traffic before scaling assumptions.

## Classes of issues this rewrite eliminates

| Today / Fly plan | After CF + DO |
|---|---|
| Upstash directory module + sweeper + heartbeat | Gone — DO singleton is the directory |
| `fly-replay` middleware + `_whoowns` pre-flight | Gone — Worker→DO routing by name |
| Last-write-wins register race (multi-machine) | Impossible — DO is single-writer per name |
| Boot-time `is_online` cleanup | Gone — `webSocketClose` callback fires reliably |
| Periodic reconciliation loop | Gone — same |
| `[[regions]]` config + per-region machine sizing | Gone — runs at every PoP |
| SIGTERM drain + 4001 dance for deploys | Simpler — `wrangler deploy` is atomic, no rolling fleet |
| Replay-rate metric and sticky-LB tuning | Gone — there's no replay |

What remains is the genuinely necessary work: streaming wire format, host-client reconnect/ping, and auth integration. Same in either world.

## New risks introduced

- **Workers CPU time** (50ms free / 30s paid per request or callback). Frame forwarding is microseconds; safe but it's a new constraint.
- **DO memory ceiling** (128 MB). Streaming protocol keeps this bounded.
- **WS frame size** (hard limit 1 MiB per Worker WebSocket message). Chunk size in our streaming protocol must stay <512 KB to be safe.
- **Vendor lock-in.** DO is proprietary; lifting off CF later is a rewrite. Acceptable trade given the relay is an isolated service.
- **Local dev** uses `wrangler dev` (Miniflare V8) instead of `bun run`. Different from rest of monorepo; precedent set by `apps/electric-proxy`.
- **JWKS cold-start**: each new isolate fetches JWKS once. <50ms; doesn't matter in practice.

## Out of scope (intentional)

- `v2_machines` data-model refactor (Phase 6 from old plan).
- Custom alerting rules — CF dashboard gives us metrics out of the box.
- Migrating `apps/electric-proxy` or other Workers — independent.
- Per-region DO `locationHint` tuning. Default migration heuristic is fine until telemetry shows a problem.

## Critical files for implementation

- `apps/electric-proxy/wrangler.jsonc` — copy as starting point for `wrangler.jsonc`
- `apps/electric-proxy/src/auth.ts` — already-Workers-compatible JWT verify, copy
- `apps/electric-proxy/package.json` — reference for Workers tooling versions
- `apps/relay/src/auth.ts:1-41` — same code, already Workers-compatible
- `apps/relay/src/access.ts:1-26` — same code, copy verbatim
- `apps/relay/src/api-client.ts:1-16` — same code, copy verbatim
- `apps/relay/src/index.ts:31-40` — `extractToken` helper, copy
- `apps/relay/src/tunnel.ts` — reference for what state the DO needs to hold; rewrite, don't port
- `packages/host-service/src/tunnel/tunnel-client.ts` — modify in place for streaming + 4001
- `packages/host-service/src/tunnel/types.ts` — modify in place for new wire types
- `packages/trpc/src/router/host/host.ts:142` — leave; DO calls existing `setOnline`
- `packages/cli/src/lib/env.ts:8` — flip default `RELAY_URL` at cutover step

## Verification

End-to-end gates per phase:

1. **Direct DO smoke**: deploy CF, point one dev desktop at `relay-cf.superset.sh`. Tunnel registers, web client opens a workspace, terminal works, all tRPC calls succeed.
2. **Streaming**: open a chat tRPC subscription; verify chunks arrive incrementally (capture in browser devtools / `wrangler tail`). Trigger a 10 MB download via the tunnel; verify TTFB < 1s.
3. **DO singleton**: force two host-service processes to claim the same `hostId`. First gets close 1000 "replaced"; second owns the tunnel. Web reconnects to the new owner without intervention.
4. **Hibernation**: leave an idle tunnel for an hour. Verify `wrangler tail` shows ~zero events; CF dashboard shows DO duration billing near zero.
5. **Code deploy**: `wrangler deploy` while tunnels are connected. Hosts see a brief WS close; reconnect within 2s on the new code; users don't notice.
6. **Auth gates**: bad JWT → 401 from Worker, never hits DO (verify in `wrangler tail`). Org membership check failure → 403 from Worker.
7. **Cross-region**: ask an EU teammate to run `RELAY_URL=https://relay-cf.superset.sh` against their desktop. Trigger requests from a US client. Confirm both legs are <100ms (visible in CF analytics).
8. **Load**: `tunnel-client.ts` smoke script spinning 1000 synthetic hosts + 100 client RPS. Watch CF analytics for error rate, p95 latency, DO duration cost. Confirm projections.

After step 8 passes for a week, proceed to default-flip + DNS cutover.
