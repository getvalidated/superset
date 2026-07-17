#!/bin/bash
#
# Entrypoint for the sandboxed Superset host container.
#
# Starts as root to (1) give the data volume to the unprivileged user and
# (2) install a stable per-volume /etc/machine-id — getHostId() derives the
# relay routing key from it, and containers without one would either collide
# (shared image machine-id) or re-register as a brand-new host on every
# recreate (hostname fallback). Everything after that runs as `superset`.
set -euo pipefail

: "${SUPERSET_HOME_DIR:=/data}"
: "${PORT:=4879}"
: "${SUPERSET_API_URL:=https://api.superset.sh}"
: "${RELAY_URL:=https://relay.superset.sh}"

log() { echo "[sandbox-host] $*"; }

mkdir -p "$SUPERSET_HOME_DIR"
chown superset:superset "$SUPERSET_HOME_DIR"

if [ ! -s "$SUPERSET_HOME_DIR/machine-id" ]; then
	od -An -tx1 -N16 /dev/urandom | tr -d ' \n' >"$SUPERSET_HOME_DIR/machine-id"
	chown superset:superset "$SUPERSET_HOME_DIR/machine-id"
	log "generated machine-id for this data volume"
fi
cat "$SUPERSET_HOME_DIR/machine-id" >/etc/machine-id

# Make the restricted GCP identity the ambient one for every terminal the
# host spawns. The key is mounted read-only; activation just writes gcloud
# config under the superset user's home.
if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
	if [ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
		gosu superset gcloud auth activate-service-account \
			--key-file="$GOOGLE_APPLICATION_CREDENTIALS" --quiet \
			&& log "activated gcloud service account $(gosu superset gcloud config get-value account 2>/dev/null)" \
			|| log "WARNING: gcloud service-account activation failed; continuing without it"
	else
		log "WARNING: GOOGLE_APPLICATION_CREDENTIALS=$GOOGLE_APPLICATION_CREDENTIALS not found; continuing without it"
	fi
fi

CONFIG_PATH="$SUPERSET_HOME_DIR/config.json"

# Auth resolution:
#   1. AUTH_TOKEN env (static session token) — fine for testing, expires.
#   2. $SUPERSET_HOME_DIR/config.json written by `superset login` — preferred:
#      the host-service refreshes tokens from it (SUPERSET_AUTH_CONFIG_PATH).
# If neither is present yet, wait for a login instead of crash-looping so the
# operator can run it in-place.
if [ -z "${AUTH_TOKEN:-}" ]; then
	if [ ! -s "$CONFIG_PATH" ] || [ "$(jq -r '.auth.accessToken // .apiKey // empty' "$CONFIG_PATH" 2>/dev/null)" = "" ]; then
		log "no credentials yet — run:  docker exec -it <container> superset login"
		log "waiting for $CONFIG_PATH ..."
		until [ -s "$CONFIG_PATH" ] && [ "$(jq -r '.auth.accessToken // .apiKey // empty' "$CONFIG_PATH" 2>/dev/null)" != "" ]; do
			sleep 5
		done
		log "credentials detected, continuing startup"
	fi
	export SUPERSET_AUTH_CONFIG_PATH="$CONFIG_PATH"
	# env.ts requires AUTH_TOKEN to be non-empty even when the config-file
	# token source is used; serve.ts ignores it in that case.
	export AUTH_TOKEN="unused-config-file-auth"
fi

if [ -z "${ORGANIZATION_ID:-}" ]; then
	ORGANIZATION_ID="$(jq -r '.organizationId // empty' "$CONFIG_PATH" 2>/dev/null || true)"
	if [ -z "$ORGANIZATION_ID" ]; then
		log "ERROR: ORGANIZATION_ID not set and not present in $CONFIG_PATH"
		log "set it in the environment or run:  docker exec -it <container> superset login"
		exit 1
	fi
fi
export ORGANIZATION_ID

HOST_DIR="$SUPERSET_HOME_DIR/host/$ORGANIZATION_ID"
gosu superset mkdir -p "$HOST_DIR"

if [ -z "${HOST_SERVICE_SECRET:-}" ]; then
	if [ ! -s "$HOST_DIR/host-service-secret" ]; then
		od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$HOST_DIR/host-service-secret"
		chown superset:superset "$HOST_DIR/host-service-secret"
		chmod 600 "$HOST_DIR/host-service-secret"
	fi
	HOST_SERVICE_SECRET="$(cat "$HOST_DIR/host-service-secret")"
fi

export PORT SUPERSET_API_URL RELAY_URL HOST_SERVICE_SECRET
export HOST_DB_PATH="${HOST_DB_PATH:-$HOST_DIR/host.db}"
export HOST_MIGRATIONS_FOLDER="${HOST_MIGRATIONS_FOLDER:-/opt/superset/share/migrations}"
export HOME=/home/superset

log "starting host-service (org=$ORGANIZATION_ID port=$PORT api=$SUPERSET_API_URL relay=$RELAY_URL)"
exec gosu superset /opt/superset/bin/superset-host
