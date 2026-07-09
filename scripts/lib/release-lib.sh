#!/usr/bin/env bash

# Shared release primitives — SOURCE this file, do not execute it.
#
# Single source of truth for (a) which packages track the desktop version and
# (b) how versions are written and checked. Consumed by:
#   - scripts/release.sh            (the one entry point)
#   - apps/desktop/create-release.sh (desktop flow)
#   - scripts/bump-cli.sh           (interim CLI flow)
#   - scripts/check-versions.sh     (CI guard)
#
# Add a package to UNIFIED_PACKAGES here and every flow + the CI check follows,
# so the bundle can't drift. See plans/20260709-unified-version-bumping.md.

# Desktop is the ceiling (a plain MAJOR.MINOR.PATCH release) and is NOT listed
# below. pty-daemon is intentionally excluded (its own 0.x track).
DESKTOP_PACKAGE="apps/desktop"
UNIFIED_PACKAGES=(packages/host-service packages/cli)

pkg_version() { jq -r .version "$1/package.json"; }

# set_pkg_version <repo_root> <pkg-path> <version> — write + format one package.
set_pkg_version() {
  local repo_root="$1" pkg="$2" version="$3"
  local file="${repo_root}/${pkg}/package.json" tmp
  tmp=$(mktemp)
  jq ".version = \"${version}\"" "${file}" >"${tmp}" && mv "${tmp}" "${file}"
  (cd "${repo_root}" && bunx biome format --write "${pkg}/package.json" >/dev/null)
}

# sync_unified_versions <repo_root> <version> — set every UNIFIED_PACKAGES entry.
sync_unified_versions() {
  local repo_root="$1" version="$2" pkg
  for pkg in "${UNIFIED_PACKAGES[@]}"; do
    set_pkg_version "${repo_root}" "${pkg}" "${version}"
  done
}

# refresh_lockfile <repo_root> — keep bun.lock's workspace versions consistent
# so `--frozen` CI installs don't fail on drift.
refresh_lockfile() {
  local repo_root="$1"
  (cd "${repo_root}" && bun install --lockfile-only >/dev/null 2>&1 || true)
}

increment_patch() {
  local a b c
  IFS='.' read -r a b c <<<"$1"
  echo "${a}.${b}.$((c + 1))"
}
increment_minor() {
  local a b c
  IFS='.' read -r a b c <<<"$1"
  echo "${a}.$((b + 1)).0"
}
increment_major() {
  local a b c
  IFS='.' read -r a b c <<<"$1"
  echo "$((a + 1)).0.0"
}

# --- Release-time diff check -------------------------------------------------
# At release time we diff the working tree against the previous release to (a)
# show what's shipping and (b) HARD-BLOCK if load-bearing code (pty-daemon)
# changed without a version bump. This runs at the release chokepoint, which
# can't be skipped, so a daemon fix can't silently ship without marking old
# daemons update-pending.

# component-name:src-dir pairs, in display order.
RELEASE_COMPONENTS=(
  "desktop:apps/desktop/src"
  "host-service:packages/host-service/src"
  "cli:packages/cli/src"
  "pty-daemon:packages/pty-daemon/src"
)

# previous_release_tag <repo_root> <desktop|cli> — newest well-formed tag for the
# stream (empty if none). Filters out malformed historical tags (e.g.
# desktop-vdesktop-v0.0.14) that version-sort would otherwise float to the top.
previous_release_tag() {
  local pattern re
  case "$2" in
    desktop) pattern="desktop-v*" ; re='^desktop-v[0-9]+\.[0-9]+\.[0-9]+$' ;;
    cli) pattern="cli-v*" ; re='^cli-v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' ;;
    *) return 1 ;;
  esac
  git -C "$1" tag -l "$pattern" --sort=-version:refname | grep -E "$re" | head -1
}

# _src_changed_since <repo_root> <ref> <dir> — true if <dir> changed ref..HEAD.
_src_changed_since() {
  [ -d "$1/$3" ] && ! git -C "$1" diff --quiet "$2"..HEAD -- "$3" 2>/dev/null
}

# changed_components <repo_root> <ref> — echo each component whose src changed.
changed_components() {
  local entry
  for entry in "${RELEASE_COMPONENTS[@]}"; do
    _src_changed_since "$1" "$2" "${entry#*:}" && echo "${entry%%:*}"
  done
}

# daemon_needs_bump <repo_root> — true if pty-daemon/src changed since the commit
# that last touched its package.json (i.e. since its last version bump).
daemon_needs_bump() {
  local base
  base=$(git -C "$1" log -1 --format=%H -- packages/pty-daemon/package.json 2>/dev/null)
  [ -n "$base" ] && _src_changed_since "$1" "$base" packages/pty-daemon/src
}

# release_diff_report <repo_root> <desktop|cli> — print what changed since the
# previous release of the stream. Best-effort; never fails the release.
release_diff_report() {
  local prev changed
  prev=$(previous_release_tag "$1" "$2" 2>/dev/null || true)
  if [ -z "$prev" ]; then
    echo "  (no previous $2 release tag — skipping diff report)"
    return 0
  fi
  if ! git -C "$1" rev-parse -q --verify "${prev}^{commit}" >/dev/null 2>&1; then
    git -C "$1" fetch --tags --quiet origin >/dev/null 2>&1 || true
  fi
  if ! git -C "$1" rev-parse -q --verify "${prev}^{commit}" >/dev/null 2>&1; then
    echo "  (previous tag ${prev} not available locally — skipping diff report)"
    return 0
  fi
  changed=$(changed_components "$1" "$prev" | tr '\n' ' ')
  echo "  Since ${prev}: changed = ${changed:-none}"
}

# bump_daemon_patch <repo_root> — patch-bump pty-daemon on its own track; echo
# "<old> -> <new>". Both release flows share this so daemon bumps are identical.
bump_daemon_patch() {
  local old new
  old=$(pkg_version "$1/packages/pty-daemon")
  new=$(increment_patch "$old")
  set_pkg_version "$1" "packages/pty-daemon" "$new"
  echo "${old} -> ${new}"
}

# guard_daemon_bump <repo_root> <bumping_daemon:true|false> [fix_hint] — BLOCK
# (return 1) if the daemon source changed since its last version bump but this
# release isn't bumping it.
guard_daemon_bump() {
  [ "$2" = "true" ] && return 0
  daemon_needs_bump "$1" || return 0
  local cur
  cur=$(pkg_version "$1/packages/pty-daemon")
  echo "" >&2
  echo "  ✗ pty-daemon/src changed since its last version bump (still ${cur}) but this release doesn't bump the daemon." >&2
  echo "    Old daemons won't be marked update-pending, so the fix won't ship on the shared org socket." >&2
  echo "    ${3:-Re-run with --daemon to patch-bump pty-daemon on its own track.}" >&2
  return 1
}

# assert_unified <repo_root> — verify UNIFIED_PACKAGES share the desktop base
# (never above desktop) and equal each other. Prints each failure; returns 1 on
# drift, 0 when unified.
assert_unified() {
  local repo_root="$1" desktop base fail=0 pkg v first=""
  desktop=$(pkg_version "${repo_root}/${DESKTOP_PACKAGE}")
  if ! [[ "$desktop" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "  ✗ desktop version '${desktop}' is not a plain MAJOR.MINOR.PATCH release"
    fail=1
  fi
  for pkg in "${UNIFIED_PACKAGES[@]}"; do
    v=$(pkg_version "${repo_root}/${pkg}")
    base="${v%%-*}"
    [ "$base" = "$desktop" ] || {
      echo "  ✗ ${pkg} '${v}' base != desktop '${desktop}'"
      fail=1
    }
    if [ -z "$first" ]; then
      first="$v"
    elif [ "$v" != "$first" ]; then
      echo "  ✗ ${pkg} '${v}' != '${first}' (unified packages must match)"
      fail=1
    fi
  done
  return "$fail"
}
