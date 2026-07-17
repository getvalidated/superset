# Sandboxed Superset host container

Runs the headless Superset host-service (`packages/host-service/src/serve.ts`)
in a Docker container so that workspaces and agents dispatched to it — e.g.
from a Linear-triage session — execute behind a container boundary with a
**deliberately restricted cloud identity**, instead of on the developer's
machine with the developer's full credentials.

## Threat model / what this buys you

A malicious or confused agent prompt (e.g. injected through a Linear ticket)
running on a normal host has everything the developer has: filesystem, gcloud
session (all 130+ Secret Manager secrets in `validated-ai`, including prod
write credentials), git credentials for every repo. Inside this container the
blast radius is:

| Surface | Normal host | Sandbox container |
| --- | --- | --- |
| Filesystem | whole machine | container FS + one named volume |
| GCP | everything michael@valid.co can do | `superset-sandbox-host@validated-ai` SA: per-secret accessor on an explicit allowlist, **no project-level roles**, cannot even list secrets |
| GitHub | all repos via personal creds | only what `SANDBOX_GITHUB_TOKEN` (fine-grained PAT) allows |
| Databases | prod write via secrets | no DB secrets today; add **read-only** connection strings as allowlisted secrets (see below) |

The restricted identity currently has `roles/secretmanager.secretAccessor` on:

- `linear-api-key-prod`

Grant more with (one secret at a time, never project-level):

```sh
gcloud secrets add-iam-policy-binding <secret-name> --project=validated-ai \
  --member="serviceAccount:superset-sandbox-host@validated-ai.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

The SA key lives at `~/.superset-sandbox/gcp/superset-sandbox-host.json`
(outside the repo, mode 600) and is mounted read-only into the container.

### Read-only database access (TODO — needs control-plane logins)

The prod connection strings in Secret Manager are full-privilege, so IAM alone
cannot make DB access read-only. The plan is one read-only user per store,
saved as new secrets (e.g. `mongodb-connection-string-readonly-prod`) and
allowlisted for the SA:

- **MongoDB Atlas** (`prod.pwugnfe.mongodb.net`): Atlas manages database users
  in its control plane — create a `readAnyDatabase` user in the Atlas UI/API
  (no Atlas API key exists in Secret Manager, so this needs an Atlas login).
- **ClickHouse**: create a `readonly=1` user with the admin credentials.
- **Supabase**: use the anon key (RLS-gated) or a read-only Postgres role, not
  the service-role key.

## Usage

```sh
cd docker/sandbox-host
cp .env.example .env        # fill in (all optional except the tokens you want)
docker compose up -d --build
docker logs -f superset-sandbox-host
```

First run, if you didn't provide `AUTH_TOKEN`/`ORGANIZATION_ID`:

```sh
docker exec -it superset-sandbox-host superset login
```

The entrypoint waits for `config.json` to appear on the data volume, then
starts the host-service with `SUPERSET_AUTH_CONFIG_PATH` pointed at it (so
tokens auto-refresh). The host registers with the org via
`api.host.ensure` and opens a tunnel to `RELAY_URL`; it then appears in
`hosts_list` and can receive `workspaces_create` / agent dispatches like any
other host.

Smoke test from the host machine:

```sh
curl -fsS -H "Authorization: Bearer $(docker exec superset-sandbox-host \
  cat /data/host/<org-id>/host-service-secret)" \
  http://127.0.0.1:14879/trpc/health.check
```

## Design notes

- **Build** reuses `packages/cli` `build:dist` (same pipeline as the released
  CLI): bun install `--frozen --ignore-scripts`, `node-gyp rebuild` for
  node-pty, `npm rebuild @parcel/watcher`, Node-ABI better-sqlite3 prebuild,
  glibc (`-gnu`) native variants — hence a Debian (not Alpine) base.
- **machine-id**: `getHostId()` derives the relay routing key from
  `/etc/machine-id`. Containers share an image and would collide (or churn a
  new host identity on every recreate via the hostname fallback), so the
  entrypoint persists a random machine-id on the data volume and installs it
  at boot. Wiping the volume = registering a fresh host.
- **Non-root**: the entrypoint does root-only setup (volume chown,
  `/etc/machine-id`), then `gosu`'s to uid-1000 `superset` for the service and
  everything it spawns; `no-new-privileges` is set in compose.
- **pty-daemon** is bundled next to `host-service.js` and spawned by the
  host-service's DaemonSupervisor inside the same container.
- **Inbound access** is via the relay tunnel only; port 4879 is published on
  127.0.0.1 purely for local debugging.

## Explicitly out of scope here (next steps for the Linear pipeline)

- The five-minute Linear triage loop itself (poll → scrutinize → dispatch),
  including the malicious-request checks with extra scrutiny for anything
  touching prod data or the host filesystem.
- Read-only DB users + `*-readonly-*` secrets (blocked on Atlas/ClickHouse
  control-plane logins, see above).
- Egress restriction (an allowlist proxy / docker network policy) if you want
  to also bound exfiltration, not just corruption.
