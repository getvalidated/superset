#!/usr/bin/env bash

# Interim CLI release.
#
# Bumps the CLI bundle (cli + host-service) to a prerelease under the current
# desktop version — e.g. desktop 1.14.0 -> cli 1.14.0-1, 1.14.0-2, ... These
# sort BELOW the desktop release in semver, so the CLI never ships a version
# above desktop. Tags cli-v<version> to trigger release-cli.yml (which bundles
# host-service). pty-daemon is intentionally excluded for now.
#
# For a version that matches desktop exactly (e.g. shipping the CLI alongside a
# desktop release), use apps/desktop/create-release.sh instead — it sets all
# three to the same plain version.
#
# Usage:
#   ./scripts/bump-cli.sh              # auto-increment suffix, commit, tag, watch
#   ./scripts/bump-cli.sh 3            # force suffix -3
#   ./scripts/bump-cli.sh --no-tag     # bump + commit only (no tag/push/watch)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}ℹ ${NC}$1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() {
  echo -e "${RED}✗${NC} $1"
  exit 1
}

# Parse args
FORCE_SUFFIX=""
NO_TAG=false
for arg in "$@"; do
  case "$arg" in
    --no-tag) NO_TAG=true ;;
    -*) error "Unknown option: $arg\nUsage: $0 [suffix] [--no-tag]" ;;
    *)
      if [[ "$arg" =~ ^[0-9]+$ ]]; then
        FORCE_SUFFIX="$arg"
      else
        error "Suffix must be a positive integer, got: $arg"
      fi
      ;;
  esac
done

command -v jq &>/dev/null || error "jq is required but not installed."
command -v gh &>/dev/null || error "GitHub CLI (gh) is required but not installed."

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "${REPO_ROOT}"
[ -f "package.json" ] && [ -d "apps/desktop" ] || error "Run this from the monorepo root."

DESKTOP=$(jq -r .version apps/desktop/package.json)
if ! [[ "$DESKTOP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  error "Desktop version '${DESKTOP}' is not a plain MAJOR.MINOR.PATCH release; cannot base a CLI prerelease on it."
fi

CLI_CUR=$(jq -r .version packages/cli/package.json)

# Determine the next prerelease suffix under the current desktop version.
# If cli is already "<desktop>-<N>", continue from N+1; otherwise start at 1.
if [ -n "$FORCE_SUFFIX" ]; then
  NEXT="$FORCE_SUFFIX"
elif [ "${CLI_CUR%-*}" = "$DESKTOP" ] && [ "$CLI_CUR" != "$DESKTOP" ] && [[ "${CLI_CUR##*-}" =~ ^[0-9]+$ ]]; then
  NEXT=$((${CLI_CUR##*-} + 1))
else
  NEXT=1
fi

NEW_VERSION="${DESKTOP}-${NEXT}"
TAG_NAME="cli-v${NEW_VERSION}"

info "Desktop version (ceiling): ${DESKTOP}"
info "Current CLI version:       ${CLI_CUR}"
info "New CLI bundle version:    ${GREEN}${NEW_VERSION}${NC}"
echo ""

if git rev-parse "${TAG_NAME}" >/dev/null 2>&1; then
  error "Tag ${TAG_NAME} already exists. Pass a higher suffix or delete the tag first."
fi

set_pkg_version() {
  local pkg="$1" version="$2" file="packages/$1/package.json" tmp
  tmp=$(mktemp)
  jq ".version = \"${version}\"" "${file}" >"${tmp}" && mv "${tmp}" "${file}"
  bunx biome format --write "${file}" >/dev/null
}

info "Setting cli and host-service to ${NEW_VERSION}..."
set_pkg_version cli "${NEW_VERSION}"
set_pkg_version host-service "${NEW_VERSION}"
bun install --lockfile-only >/dev/null 2>&1 || true
success "Versions written"

git add packages/cli/package.json packages/host-service/package.json bun.lock
git commit -m "chore(cli): release ${NEW_VERSION} (cli + host-service ${CLI_CUR} -> ${NEW_VERSION})"
success "Committed ${CLI_CUR} -> ${NEW_VERSION}"

if [ "$NO_TAG" = true ]; then
  warn "--no-tag: skipping push/tag. Commit is on your branch; push and tag ${TAG_NAME} manually to release."
  exit 0
fi

CURRENT_BRANCH=$(git branch --show-current)
info "Pushing ${CURRENT_BRANCH}..."
git push -u origin "HEAD:${CURRENT_BRANCH}"

# Open a PR if we're on a feature branch (tag still triggers the release either way).
if [ "${CURRENT_BRANCH}" != "main" ]; then
  if ! gh pr list --head "${CURRENT_BRANCH}" --json number --jq '.[0].number' 2>/dev/null | grep -q .; then
    gh pr create \
      --title "chore(cli): release ${NEW_VERSION}" \
      --body "Interim CLI release ${NEW_VERSION} (cli + host-service). Under desktop ${DESKTOP}.

Created by scripts/bump-cli.sh." \
      --base main --head "${CURRENT_BRANCH}" >/dev/null 2>&1 && success "PR created" || warn "Could not create PR"
  fi
fi

info "Creating and pushing tag ${TAG_NAME}..."
git tag "${TAG_NAME}"
git push origin "${TAG_NAME}"
success "Tag ${TAG_NAME} pushed — release-cli.yml will build and publish"

# Watch the release workflow.
REPO=$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')
TAG_SHA=$(git rev-list -n 1 "${TAG_NAME}")
info "Locating release-cli.yml run..."
RUN=""
for _ in 1 2 3 4 5 6; do
  sleep 5
  RUN=$(gh run list --workflow=release-cli.yml \
    --json databaseId,headSha,event \
    --jq ".[] | select(.headSha == \"${TAG_SHA}\") | .databaseId" | head -1)
  [ -n "$RUN" ] && break
done

if [ -z "$RUN" ]; then
  warn "Could not find the workflow run automatically."
  echo "  Check: https://github.com/${REPO}/actions/workflows/release-cli.yml"
else
  echo "  https://github.com/${REPO}/actions/runs/${RUN}"
  gh run watch "${RUN}" || warn "Workflow monitoring interrupted"
fi

echo ""
success "CLI release ${NEW_VERSION} initiated"
