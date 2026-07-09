# Unified Version Bumping

Make **desktop, host-service, and cli** ship one shared version, enforced in CI.
`pty-daemon` is **excluded for now** (keeps its own track).

## Rules

- **Desktop is the ceiling.** It is always a plain `MAJOR.MINOR.PATCH` release.
- `host-service` and `cli` **base** (strip any `-N` suffix) must equal desktop.
- `host-service` **must equal** `cli` (they ship as one bundle).
- Interim CLI releases add a prerelease suffix: `1.14.0-1`, `1.14.0-2`, … These
  sort **below** `1.14.0` in semver, so the CLI never ships above desktop.

## One-time snap

`host-service 0.8.26 → 1.14.0`, `cli 0.2.24 → 1.14.0` (desktop already 1.14.0).
`bun.lock` refreshed. From here on all three move together.

## Desktop release (`apps/desktop/create-release.sh`)

Every desktop bump now sets **desktop + host-service + cli** to the same new
version (was: desktop + host-service patch-bump). Both the normal and
commit/worktree paths refresh `bun.lock` and commit all three package.jsons.

Commit: `chore(desktop): bump version to X (host-service a -> X, cli b -> X)`.

## Interim CLI release (`scripts/bump-cli.sh`, `bun run release:cli`)

Between desktop releases, ship a CLI-side fix without a desktop release:

- Base = current desktop version `D`.
- Suffix auto-increments: if cli is `D-N` → `D-(N+1)`, else `D-1`.
- Sets `cli` + `host-service` to `D-N`, refreshes lock, commits.
- Tags `cli-v D-N` → triggers `release-cli.yml` (bundles host-service).

`./scripts/bump-cli.sh [suffix] [--no-tag]`.

## Enforcement (`scripts/check-versions.sh`, CI `Version Sync` job)

Fails if base(host-service) ≠ desktop, base(cli) ≠ desktop, or host-service ≠ cli.
Runs as its own `pull_request` job in `.github/workflows/ci.yml`.

## Risks / notes

- **Homebrew:** `bump-homebrew.yml` already accepts `-<prerelease>` tags
  (regex `(-[A-Za-z0-9.]+)?`). First interim release should be spot-checked —
  Homebrew's `version "1.14.0-1"` parsing is untested here.
- **Shared daemon socket:** an interim CLI's bundled daemon may run alongside a
  desktop daemon on the same org socket. pty-daemon is excluded from this scheme
  for now, so its version handshake is unchanged.
- `bun.lock` stores workspace `version` fields; scripts refresh it with
  `bun install --lockfile-only` so `--frozen` CI installs stay consistent.
