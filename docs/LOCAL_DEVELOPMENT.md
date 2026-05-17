# Local Development

How to run Superset locally from a fresh clone with no Neon, OAuth, Stripe, Resend, or QStash keys. Local contributor state is isolated under `~/.superset-local-dev`, so this flow does not reuse production or canary desktop state from `~/.superset`.

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Docker Desktop for macOS (for Postgres and Electric SQL)
- [Caddy](https://caddyserver.com/docs/install) (for HTTPS proxy)
- macOS

## Quick Start

```bash
git clone https://github.com/superset-sh/superset.git
cd superset
bun install
bun setup:local
bun dev
```

`bun setup:local` is non-destructive. It copies `.env.example`, `apps/electric-proxy/.dev.vars.example`, and `Caddyfile.example` only when the target file is missing; starts Docker Postgres/Electric; runs `caddy trust`; and applies DB migrations.

If you already have an internal `.env`, the script leaves it untouched and stops before running migrations. Do not overwrite an internal `.env` unless you intentionally want the local contributor profile.

Useful setup flags:

```bash
bun setup:local --skip-docker
bun setup:local --skip-migrate
bun setup:local --skip-caddy-trust
```

The generated `.env` sets `SUPERSET_PROFILE=local` and `SUPERSET_WORKSPACE_NAME=local-dev`. Missing integration keys are allowed at boot; features that need them fail cleanly when exercised.

That brings up:

| Service | Port | What it does |
|---|---|---|
| Web | 4640 | Marketing-style sign-in page |
| API | 4641 | Backend (Next.js) |
| Desktop (Vite) | 4645 | Renderer dev server |
| Notifications | 4646 | Desktop notification bridge |
| Electric SQL | 4649 | Sync layer (Docker) |
| Caddy | 4650 | HTTPS proxy in front of electric-proxy |
| electric-proxy | 4652 | Cloudflare worker (Wrangler) |

The Electron window opens automatically.

### How sign-in works

On first launch in the `local` profile (when `SUPERSET_PROFILE=local` is set), the desktop main process auto-signs you in as a seed admin user:

- **Email:** `admin@local.test`
- **Password:** `supersetdev`

If the user doesn't exist, it's created and a personal organization is provisioned automatically (`Local Admin's Team`). The encrypted auth token lands in `~/.superset-local-dev/auth-token.enc`. The renderer hydrates this token like a real OAuth user — there's no special dev-only code path in the renderer.

### Deployment profiles

Profile is resolved at boot:

| Profile     | Trigger                              | Behavior |
|-------------|--------------------------------------|----------|
| `cloud`     | `VERCEL=1` or `VERCEL_ENV` (set by Vercel) | Strict — every integration key required |
| `local`     | `SUPERSET_PROFILE=local`             | Lenient — integration keys optional, features degrade |
| `ci`        | `CI=true` (set automatically by GitHub Actions, most runners) | Lenient — build/lint/test jobs run without prod secrets |
| `internal`  | default                              | Strict — covers internal team dev and self-hosted prod |

**Strict-by-default is the safe direction.** Internal devs and self-hosters keep their fail-fast workflow with no setup changes. Local contributors set `SUPERSET_PROFILE=local` once (in `.env`, or as a shell var) to opt into the lenient path. CI auto-degrades so `bun run lint/typecheck/test` works without injecting every production secret — actual deploy steps run `vercel build`, which pulls env from the Vercel project, and runtime strictness still kicks in once Vercel env markers are set.

The escape hatch `SKIP_ENV_VALIDATION=1` still works for one-off bypass cases (e.g. Docker preview builds outside of GitHub Actions).

### Boot summary + `/api/health`

When the API boots in the `local` profile, it prints a one-time summary of what's disabled:

```text
[superset] profile=local (lenient)
[superset] disabled features (set the listed env var(s) to enable):
           - stripe                       STRIPE_SECRET_KEY
           - resend (email)               RESEND_API_KEY
           - posthog (telemetry)          NEXT_PUBLIC_POSTHOG_KEY
           ...
```

For programmatic monitoring (or to confirm a key took effect), hit `GET /api/health`:

```json
{ "ok": true, "profile": "local", "integrations": { "stripe": "missing", ... } }
```

For the web app (`http://localhost:4640`), the sign-in and sign-up pages render a dev-only email/password form when `NODE_ENV !== "production"`. Use the same credentials.

## What works locally

✓ Sign-in (email/password)
✓ Database (Postgres + Drizzle)
✓ Electric SQL sync
✓ Host service (local git/worktree operations)
✓ Create workspaces, run terminals, edit files
✓ tRPC / API routing

## What's stubbed (won't fully work without keys)

- **Billing** — Stripe lazy-throws if exercised. Subscriptions/checkout disabled.
- **Email send** — Resend lazy-throws. Magic-link / password reset emails are stubbed.
- **Telemetry** — PostHog initializes only when key present; calls are no-ops otherwise.
- **Error tracking** — Sentry initializes only when DSN present.
- **OAuth (Google, GitHub)** — providers register only when their `*_CLIENT_ID` is set.
- **GitHub App / Linear / Slack** — webhooks and integrations no-op without their keys.
- **QStash background jobs** — no key → no scheduled jobs fire.
- **Upstash KV rate limiting** — falls back gracefully.
- **Cloud relay tunnel** — disabled in `local` / `ci` unless `RELAY_URL` is explicitly set.

Each is "guard, don't crash" — if you click into a feature that needs a key, you'll see a `503` or a clean exception, not a boot failure.

## Troubleshooting

**`EADDRINUSE: address already in use :::4641`** — a previous `bun dev` is still alive. `pkill -f "turbo run dev"` and retry.

**`Host service not available` toast in desktop** — the auto-sign-in didn't run or didn't persist the token. Check `~/.superset-local-dev/auth-token.enc` exists. Delete it and rerun if needed: `rm ~/.superset-local-dev/auth-token.enc && bun dev`. Also confirm the profile via `curl http://localhost:4641/api/health` returns `"profile": "local"` — if it says `internal`, you forgot to set `SUPERSET_PROFILE=local` and auto-sign-in is intentionally skipped.

**`Missing API key` for some integration** — that integration's key isn't in `.env`. Either supply it or avoid the feature.

**Electric SQL container fails to start replication** — verify `wal_level=logical` on your Postgres: `docker exec superset-pg psql -U superset -d superset -c "SHOW wal_level"` should return `logical`.

**`schema "auth" already exists` during `db:migrate`** — drop and re-migrate: `docker exec superset-pg psql -U superset -d superset -c "DROP SCHEMA auth CASCADE"` then `bun run db:migrate`.

## Resetting state

```bash
# Stop dev
pkill -f "turbo run dev"

# Wipe data (auth token, host DBs, local app state)
rm -rf ~/.superset-local-dev

# Wipe Postgres + Electric (including volume)
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
```

## Architecture notes for contributors

- **Deployment profiles** — `packages/shared/src/deployment-profile.ts` resolves `cloud | local | ci | internal` from env flags. Strict profiles fail boot on missing keys; lenient profiles (`local`, `ci`) let the app boot. Use `shouldSkipEnvValidation()` from this module when wiring env schemas, and `isLocalProfile()` when gating local-only behavior.
- **Desktop state isolation** — `.env.example` sets `SUPERSET_WORKSPACE_NAME=local-dev`, so contributor runs use `~/.superset-local-dev` and do not reuse production / canary state from `~/.superset`. Local profile desktop predev also skips macOS Launch Services cleanup and protocol patching.
- **DB driver swap** — `packages/db/src/client.ts` detects whether `DATABASE_URL` is a Neon host (`*.neon.tech`, `*.neon.build`) and uses Drizzle's `neon-http` adapter for cloud, or `node-postgres` for any other Postgres (including the local Docker one).
- **Dev auto-sign-in** — `apps/desktop/src/main/lib/dev-auto-sign-in.ts` runs once during `app.whenReady()` only in the `local` profile. POSTs to `/api/auth/sign-in/email` (auto-signs-up if user doesn't exist), persists the token via the same `saveToken()` that OAuth uses. The renderer doesn't know dev mode exists.
- **Renderer organization selection** — pages prefer `session.activeOrganizationId` from Better Auth, falling back to `MOCK_ORG_ID` only if there's no session at all. Make sure new code that needs `activeOrganizationId` follows this same priority (real session first).
- **CDP for headless tests** — in the `local` profile, the desktop main process exposes Chrome DevTools Protocol on `localhost:9333`. Useful for scripted UI checks (`curl http://localhost:9333/json/list`).
