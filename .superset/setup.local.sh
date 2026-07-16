#!/usr/bin/env bash
# Local-development setup. Provisions a fully self-contained, PER-WORKSPACE
# Superset stack backed by a local Postgres container + fake credentials — no
# Neon account, no real third-party keys. Mirrors setup.sh, but replaces the
# Neon branch with a docker-compose bundle (Postgres + neon-proxy + Electric +
# Redis/SRH) on per-workspace allocated ports so multiple worktrees never
# collide.
set -uo pipefail

SUPERSET_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SUPERSET_SCRIPT_DIR/.." && pwd)"

# shellcheck source=/dev/null
source "$SUPERSET_SCRIPT_DIR/lib/common.sh"
# shellcheck source=/dev/null
source "$SUPERSET_SCRIPT_DIR/lib/setup/steps.sh" # reuse allocate_port_base + helpers

cd "$ROOT_DIR" || exit 1

ELECTRIC_SECRET_VALUE="local_electric_dev_secret"
# Must match SRH_TOKEN in docker-compose.yml.
LOCAL_KV_TOKEN_VALUE="local_dev_token"

# Set by local_allocate_ports; consumed by docker compose + .env writing.
LOCAL_DB_PROJECT=""
LOCAL_PG_PORT=""
LOCAL_NEON_PROXY_PORT=""
LOCAL_ELECTRIC_PORT=""
LOCAL_REDIS_PORT=""
LOCAL_SRH_PORT=""

sanitize_name() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g; s/--*/-/g; s/^-//; s/-$//' | cut -c1-48
}

local_ensure_env() {
  echo "📂 Preparing .env..."
  if [ ! -f .env ]; then
    if [ ! -f .env.local.example ]; then
      error ".env.local.example not found in $ROOT_DIR"
      return 1
    fi
    cp .env.local.example .env
    success "Created .env from .env.local.example"
  else
    success ".env already exists — leaving as-is"
  fi
  return 0
}

local_check_dependencies() {
  echo "🔍 Checking dependencies..."
  local missing=()
  command -v bun &> /dev/null || missing+=("bun (https://bun.sh)")
  command -v docker &> /dev/null || missing+=("docker (https://docker.com)")
  command -v jq &> /dev/null || missing+=("jq (brew install jq)")
  command -v caddy &> /dev/null || warn "caddy not found — Electric HTTPS proxy won't work (brew install caddy && caddy trust)"
  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing dependencies:"
    for dep in "${missing[@]}"; do echo "  - $dep"; done
    return 1
  fi
  success "All dependencies found"
  return 0
}

local_allocate_ports() {
  echo "🔌 Allocating per-workspace ports..."
  if ! allocate_port_base; then
    error "Port allocation failed"
    return 1
  fi
  local base="$SUPERSET_PORT_BASE"
  # DB stack host ports live in the free tail of the 20-port window
  # (app ports use +0..+13; Electric reuses the +9 ELECTRIC_PORT slot).
  LOCAL_PG_PORT=$((base + 14))
  LOCAL_NEON_PROXY_PORT=$((base + 15))
  LOCAL_ELECTRIC_PORT=$((base + 9))
  LOCAL_REDIS_PORT=$((base + 16))
  LOCAL_SRH_PORT=$((base + 17))
  export LOCAL_PG_PORT LOCAL_NEON_PROXY_PORT LOCAL_ELECTRIC_PORT
  export LOCAL_REDIS_PORT LOCAL_SRH_PORT
  # Export so migrate/seed (child bun processes) use these — an inherited env
  # var beats the .env file, so this overrides any stale DATABASE_URL.
  export DATABASE_URL="postgres://postgres:postgres@db.localtest.me:$LOCAL_NEON_PROXY_PORT/main"
  export DATABASE_URL_UNPOOLED="postgres://postgres:postgres@localhost:$LOCAL_PG_PORT/main"
  LOCAL_DB_PROJECT="superset-$(sanitize_name "${SUPERSET_WORKSPACE_NAME:-$(basename "$PWD")}")"
  success "Base $base → pg=$LOCAL_PG_PORT proxy=$LOCAL_NEON_PROXY_PORT electric=$LOCAL_ELECTRIC_PORT redis=$LOCAL_REDIS_PORT srh=$LOCAL_SRH_PORT (project $LOCAL_DB_PROJECT)"
  return 0
}

local_db_up() {
  echo "🗄️  Starting per-workspace DB stack ($LOCAL_DB_PROJECT)..."
  if ! docker compose -p "$LOCAL_DB_PROJECT" -f "$ROOT_DIR/docker-compose.yml" up -d; then
    error "docker compose up failed"
    return 1
  fi
  echo "  Waiting for Postgres to be healthy..."
  local container_id
  container_id="$(docker compose -p "$LOCAL_DB_PROJECT" -f "$ROOT_DIR/docker-compose.yml" ps -q postgres 2>/dev/null)"
  if [ -z "$container_id" ]; then
    error "Postgres container not found"
    return 1
  fi
  local i pg_ready=0
  for i in $(seq 1 30); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null)" = "healthy" ]; then
      pg_ready=1
      break
    fi
    sleep 2
  done
  if [ "$pg_ready" -ne 1 ]; then
    error "Postgres did not become healthy within 60s"
    return 1
  fi

  # Postgres health != proxy ready. migrate uses direct pg, but seed (and the
  # app) query through the neon-http proxy, which starts + bootstraps a beat
  # later. Probe a real query so the seed never races a cold proxy.
  echo "  Waiting for neon-proxy to serve queries on :$LOCAL_NEON_PROXY_PORT..."
  local j proxy_ready=0
  for j in $(seq 1 30); do
    if curl -s --max-time 3 -X POST "http://localhost:$LOCAL_NEON_PROXY_PORT/sql" \
        -H "Neon-Connection-String: postgres://postgres:postgres@db.localtest.me:$LOCAL_NEON_PROXY_PORT/main" \
        -H "Content-Type: application/json" \
        -d '{"query":"select 1","params":[]}' 2>/dev/null | grep -q '"command"'; then
      proxy_ready=1
      break
    fi
    sleep 1
  done
  if [ "$proxy_ready" -ne 1 ]; then
    error "neon-proxy did not become ready within 30s"
    return 1
  fi

  # Same story for SRH: redis being healthy doesn't mean the HTTP shim is
  # serving yet. Probe a real command. The Content-Type header is required —
  # SRH rejects the request without it.
  echo "  Waiting for serverless-redis-http to serve commands on :$LOCAL_SRH_PORT..."
  local k srh_ready=0
  for k in $(seq 1 30); do
    if curl -s --max-time 3 -X POST "http://localhost:$LOCAL_SRH_PORT/" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $LOCAL_KV_TOKEN_VALUE" \
        -d '["PING"]' 2>/dev/null | grep -q 'PONG'; then
      srh_ready=1
      break
    fi
    sleep 1
  done
  if [ "$srh_ready" -ne 1 ]; then
    error "serverless-redis-http did not become ready within 30s"
    return 1
  fi

  success "DB stack ready (pg :$LOCAL_PG_PORT, proxy :$LOCAL_NEON_PROXY_PORT, electric :$LOCAL_ELECTRIC_PORT, redis :$LOCAL_REDIS_PORT, srh :$LOCAL_SRH_PORT)"
  return 0
}

local_migrate() {
  echo "📜 Applying database migrations..."
  if ! bun run db:migrate; then
    error "db:migrate failed"
    return 1
  fi
  success "Migrations applied"
  return 0
}

local_seed_dev_account() {
  echo "🌱 Seeding dev account (onboarded + pro)..."
  if ! bun run db:seed-dev; then
    error "db:seed-dev failed"
    return 1
  fi
  success "Dev account ready (sign in via the dev button)"
  return 0
}

local_seed_host_presets() {
  echo "🎛️  Carrying host agent presets into superset-dev-data/host/..."

  # Host agent presets (terminal agent configs) live in a per-org SQLite DB at
  # $SUPERSET_HOME_DIR/host/<orgId>/host.db. Every local workspace seeds a
  # fresh Postgres, so db:seed-dev mints a NEW random org id — host-service
  # then finds no host.db for it and re-seeds the bundled default presets,
  # resurrecting ones the user deleted and dropping custom ones. Pre-place a
  # host.db (presets only) under the new org id so customizations follow the
  # user into each new workspace.

  if ! command -v sqlite3 &> /dev/null; then
    warn "sqlite3 not found — dev app will seed bundled default presets"
    step_skipped "Seed host presets (no sqlite3)"
    return 0
  fi

  # The org id db:seed-dev just created (email must match DEV_EMAIL in
  # packages/shared/src/dev-credentials.ts).
  local org_id
  org_id="$(docker compose -p "$LOCAL_DB_PROJECT" -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    psql -U postgres -d main -Atc \
    "select m.organization_id from auth.members m join auth.users u on u.id = m.user_id where u.email = 'admin@local.test' limit 1;" \
    2>/dev/null | tr -d '[:space:]')"
  if [ -z "$org_id" ]; then
    warn "Could not resolve dev org id — dev app will seed bundled default presets"
    step_skipped "Seed host presets (no dev org)"
    return 0
  fi

  local dest_dir="superset-dev-data/host/$org_id"
  local dest_db="$dest_dir/host.db"
  if [ -f "$dest_db" ]; then
    warn "Host DB already exists at $dest_db — leaving presets as-is"
    step_skipped "Seed host presets (host.db exists)"
    return 0
  fi

  # Newest host.db that actually has configured presets: sibling local
  # workspaces first (same worktree parent), then the production app's.
  local source_db="" candidate count
  while IFS= read -r candidate; do
    count="$(sqlite3 "file:$candidate?mode=ro" \
      "select count(*) from host_agent_configs;" 2>/dev/null || echo 0)"
    if [ "${count:-0}" -gt 0 ] 2>/dev/null; then
      source_db="$candidate"
      break
    fi
  done < <(ls -t \
    "$(dirname "$ROOT_DIR")"/*/superset-dev-data/host/*/host.db \
    "$HOME/.superset/host"/*/host.db 2>/dev/null)

  if [ -z "$source_db" ]; then
    warn "No prior host.db with presets found — dev app will seed bundled defaults"
    step_skipped "Seed host presets (no source)"
    return 0
  fi

  mkdir -p "$dest_dir"
  chmod 700 superset-dev-data superset-dev-data/host "$dest_dir"

  # Copy all SQLite files so WAL contents survive a live writer, then
  # checkpoint the copy (nothing else has it open yet).
  local ext
  for ext in "" "-shm" "-wal"; do
    if [ -f "${source_db}${ext}" ]; then
      if ! cp "${source_db}${ext}" "${dest_db}${ext}"; then
        error "Failed to copy ${source_db}${ext}"
        rm -f "$dest_db" "${dest_db}-shm" "${dest_db}-wal"
        return 1
      fi
      chmod 600 "${dest_db}${ext}"
    fi
  done
  sqlite3 "$dest_db" "PRAGMA wal_checkpoint(TRUNCATE);" &> /dev/null || true

  # Keep ONLY the presets (plus drizzle's migration journal so host-service
  # migrations stay aligned): the copy also carries the source instance's
  # workspaces/projects/sessions, which belong to that instance, not this one.
  local table
  while IFS= read -r table; do
    sqlite3 "$dest_db" "delete from \"$table\";" 2>/dev/null || true
  done < <(sqlite3 "$dest_db" \
    "select name from sqlite_master where type='table' and name not in ('host_agent_configs','__drizzle_migrations');")
  sqlite3 "$dest_db" "vacuum;" &> /dev/null || true

  success "Presets carried over from $source_db (org $org_id)"
  return 0
}

local_write_env() {
  echo "📝 Writing workspace .env (DB URLs + ports)..."
  if [ -z "${SUPERSET_PORT_BASE:-}" ] || [ -z "$LOCAL_NEON_PROXY_PORT" ]; then
    error "Ports not allocated before writing .env"
    return 1
  fi

  local BASE="$SUPERSET_PORT_BASE"
  local WEB_PORT=$((BASE))
  local API_PORT=$((BASE + 1))
  local MARKETING_PORT=$((BASE + 2))
  local ADMIN_PORT=$((BASE + 3))
  local DOCS_PORT=$((BASE + 4))
  local DESKTOP_VITE_PORT=$((BASE + 5))
  local DESKTOP_NOTIFICATIONS_PORT=$((BASE + 6))
  local STREAMS_PORT=$((BASE + 7))
  local STREAMS_INTERNAL_PORT=$((BASE + 8))
  local CADDY_ELECTRIC_PORT=$((BASE + 10))
  local CODE_INSPECTOR_PORT=$((BASE + 11))
  local WRANGLER_PORT=$((BASE + 12))
  local RELAY_PORT=$((BASE + 13))

  {
    echo ""
    echo "# ===== Local workspace overrides (setup.local.sh) ====="
    write_env_var "SUPERSET_WORKSPACE_NAME" "${SUPERSET_WORKSPACE_NAME:-$(basename "$PWD")}"
    write_env_var "SUPERSET_HOME_DIR" "$PWD/superset-dev-data"
    write_env_var "SUPERSET_PORT_BASE" "$BASE"
    echo ""
    echo "# Per-workspace local DB stack (docker compose project $LOCAL_DB_PROJECT)"
    write_env_var "LOCAL_PG_PORT" "$LOCAL_PG_PORT"
    write_env_var "LOCAL_NEON_PROXY_PORT" "$LOCAL_NEON_PROXY_PORT"
    write_env_var "LOCAL_ELECTRIC_PORT" "$LOCAL_ELECTRIC_PORT"
    write_env_var "LOCAL_REDIS_PORT" "$LOCAL_REDIS_PORT"
    write_env_var "LOCAL_SRH_PORT" "$LOCAL_SRH_PORT"
    write_env_var "DATABASE_URL" "$DATABASE_URL"
    write_env_var "DATABASE_URL_UNPOOLED" "$DATABASE_URL_UNPOOLED"
    echo ""
    echo "# Relay host directory: real redis behind the SRH HTTP shim"
    write_env_var "KV_REST_API_URL" "http://localhost:$LOCAL_SRH_PORT"
    write_env_var "KV_REST_API_TOKEN" "$LOCAL_KV_TOKEN_VALUE"
    write_env_var "KV_URL" "redis://localhost:$LOCAL_REDIS_PORT"
    echo ""
    echo "# Workspace ports"
    write_env_var "WEB_PORT" "$WEB_PORT"
    write_env_var "API_PORT" "$API_PORT"
    write_env_var "MARKETING_PORT" "$MARKETING_PORT"
    write_env_var "ADMIN_PORT" "$ADMIN_PORT"
    write_env_var "DOCS_PORT" "$DOCS_PORT"
    write_env_var "DESKTOP_VITE_PORT" "$DESKTOP_VITE_PORT"
    write_env_var "DESKTOP_NOTIFICATIONS_PORT" "$DESKTOP_NOTIFICATIONS_PORT"
    write_env_var "STREAMS_PORT" "$STREAMS_PORT"
    write_env_var "STREAMS_INTERNAL_PORT" "$STREAMS_INTERNAL_PORT"
    write_env_var "CADDY_ELECTRIC_PORT" "$CADDY_ELECTRIC_PORT"
    write_env_var "CODE_INSPECTOR_PORT" "$CODE_INSPECTOR_PORT"
    write_env_var "WRANGLER_PORT" "$WRANGLER_PORT"
    write_env_var "RELAY_PORT" "$RELAY_PORT"
    write_env_var "ELECTRIC_PORT" "$LOCAL_ELECTRIC_PORT"
    write_env_var "ELECTRIC_SECRET" "$ELECTRIC_SECRET_VALUE"
    echo ""
    echo "# Cross-app URLs (allocated ports)"
    write_env_var "NEXT_PUBLIC_API_URL" "http://localhost:$API_PORT"
    write_env_var "NEXT_PUBLIC_WEB_URL" "http://localhost:$WEB_PORT"
    write_env_var "NEXT_PUBLIC_MARKETING_URL" "http://localhost:$MARKETING_PORT"
    write_env_var "NEXT_PUBLIC_ADMIN_URL" "http://localhost:$ADMIN_PORT"
    write_env_var "NEXT_PUBLIC_DOCS_URL" "http://localhost:$DOCS_PORT"
    write_env_var "NEXT_PUBLIC_DESKTOP_URL" "http://localhost:$DESKTOP_VITE_PORT"
    write_env_var "RELAY_URL" "http://localhost:$RELAY_PORT"
    write_env_var "NEXT_PUBLIC_RELAY_URL" "http://localhost:$RELAY_PORT"
    write_env_var "SUPERSET_WEB_URL" "http://localhost:$WEB_PORT"
    echo ""
    echo "# Streams URLs"
    write_env_var "PORT" "$STREAMS_PORT"
    write_env_var "STREAMS_URL" "http://localhost:$STREAMS_PORT"
    write_env_var "NEXT_PUBLIC_STREAMS_URL" "http://localhost:$STREAMS_PORT"
    write_env_var "STREAMS_INTERNAL_URL" "http://127.0.0.1:$STREAMS_INTERNAL_PORT"
    echo ""
    echo "# Electric URLs (per-workspace Electric :$LOCAL_ELECTRIC_PORT, fronted by Caddy)"
    write_env_var "ELECTRIC_URL" "http://localhost:$LOCAL_ELECTRIC_PORT/v1/shape"
    write_env_var "NEXT_PUBLIC_ELECTRIC_URL" "https://localhost:$CADDY_ELECTRIC_PORT"
    write_env_var "NEXT_PUBLIC_ELECTRIC_PROXY_URL" "https://localhost:$CADDY_ELECTRIC_PORT"
    echo ""
    echo "# Mobile (Expo) — plain-HTTP electric-proxy; RN fetch rejects Caddy's self-signed cert"
    write_env_var "EXPO_PUBLIC_API_URL" "http://localhost:$API_PORT"
    write_env_var "EXPO_PUBLIC_ELECTRIC_URL" "http://localhost:$WRANGLER_PORT"
    write_env_var "EXPO_PUBLIC_POSTHOG_KEY" "phc_local_dev_disabled"
  } >> .env

  cat > Caddyfile <<-CADDYEOF
	{
		auto_https disable_redirects
	}

	https://localhost:{\$CADDY_ELECTRIC_PORT} {
		reverse_proxy localhost:{\$WRANGLER_PORT} {
			flush_interval -1
		}
	}
	CADDYEOF

  cat > apps/electric-proxy/.dev.vars <<DEVVARS
AUTH_URL=http://localhost:$API_PORT
ELECTRIC_SHAPE_URL=http://localhost:$LOCAL_ELECTRIC_PORT/v1/shape
ELECTRIC_SECRET=$ELECTRIC_SECRET_VALUE
ELECTRIC_SOURCE_ID=
ELECTRIC_SOURCE_SECRET=
DEVVARS

  cat > "$SUPERSET_SCRIPT_DIR/ports.json" <<PORTSJSON
{
  "ports": [
    { "port": $WEB_PORT, "label": "Web" },
    { "port": $API_PORT, "label": "API" },
    { "port": $MARKETING_PORT, "label": "Marketing" },
    { "port": $ADMIN_PORT, "label": "Admin" },
    { "port": $DOCS_PORT, "label": "Docs" },
    { "port": $DESKTOP_VITE_PORT, "label": "Desktop Vite" },
    { "port": $DESKTOP_NOTIFICATIONS_PORT, "label": "Notifications" },
    { "port": $STREAMS_PORT, "label": "Streams" },
    { "port": $LOCAL_ELECTRIC_PORT, "label": "Electric" },
    { "port": $CADDY_ELECTRIC_PORT, "label": "Caddy Electric" },
    { "port": $WRANGLER_PORT, "label": "Electric Proxy (Wrangler)" },
    { "port": $LOCAL_PG_PORT, "label": "Postgres" },
    { "port": $LOCAL_NEON_PROXY_PORT, "label": "Neon Proxy" },
    { "port": $LOCAL_REDIS_PORT, "label": "Redis" },
    { "port": $LOCAL_SRH_PORT, "label": "Redis HTTP (SRH)" }
  ]
}
PORTSJSON

  success "Workspace .env, Caddyfile, electric-proxy/.dev.vars, ports.json written"
  return 0
}

local_write_config_overlay() {
  echo "🔧 Writing .superset/config.local.json (untracked overlay)..."
  cat > "$SUPERSET_SCRIPT_DIR/config.local.json" <<'CONFIGLOCAL'
{
  "setup": ["./.superset/setup.local.sh"],
  "teardown": ["./.superset/teardown.local.sh"]
}
CONFIGLOCAL
  success "config.local.json written — worktrees will use setup.local.sh"
  return 0
}

local_setup_main() {
  FAILED_STEPS=()
  SKIPPED_STEPS=()

  echo "🚀 Setting up Superset for LOCAL development..."
  echo ""

  local_ensure_env || step_failed "Prepare .env"
  local_check_dependencies || step_failed "Check dependencies"
  step_install_dependencies || step_failed "Install dependencies"
  local_allocate_ports || step_failed "Allocate ports"
  local_write_env || step_failed "Write workspace .env"
  local_db_up || step_failed "Start local DB stack"
  local_migrate || step_failed "Apply migrations"
  local_seed_dev_account || step_failed "Seed dev account"
  local_seed_host_presets || step_failed "Seed host presets"
  local_write_config_overlay || step_failed "Write config overlay"

  print_summary "Local setup"
}

local_setup_main "$@"
