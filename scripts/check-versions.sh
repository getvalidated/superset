#!/usr/bin/env bash

# Enforces unified versioning across the desktop app and the CLI bundle.
#
# Rule: desktop is the ceiling and is always a plain MAJOR.MINOR.PATCH release.
# host-service and cli must share that base version and must equal each other
# (they ship as one bundle). Interim CLI releases add a prerelease suffix
# (e.g. 1.14.0-1) which sorts BELOW the desktop release, so the CLI never ships
# a version above desktop.
#
# pty-daemon is intentionally excluded for now (tracks its own version).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ver() { jq -r .version "${ROOT}/$1/package.json"; }
base() { echo "${1%%-*}"; } # strip -prerelease suffix

DESKTOP="$(ver apps/desktop)"
HOST="$(ver packages/host-service)"
CLI="$(ver packages/cli)"

fail=0
note() {
  echo "  ✗ $1"
  fail=1
}

# Desktop is the ceiling and must be a plain release (no prerelease).
if ! [[ "$DESKTOP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  note "desktop version '${DESKTOP}' is not a plain MAJOR.MINOR.PATCH release"
fi

# host-service and cli must share the desktop base (never above desktop).
[ "$(base "$HOST")" = "$DESKTOP" ] || note "host-service '${HOST}' base != desktop '${DESKTOP}'"
[ "$(base "$CLI")" = "$DESKTOP" ] || note "cli '${CLI}' base != desktop '${DESKTOP}'"

# The CLI bundle (cli + host-service) must move together.
[ "$HOST" = "$CLI" ] || note "host-service '${HOST}' != cli '${CLI}' (bundle must match)"

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Version drift detected. Unified rule: desktop == host-service == cli"
  echo "(interim CLI releases may add a -N suffix, e.g. ${DESKTOP}-1)."
  echo "  desktop=${DESKTOP}  host-service=${HOST}  cli=${CLI}"
  exit 1
fi

echo "✓ versions unified: desktop=${DESKTOP} host-service=${HOST} cli=${CLI}"
