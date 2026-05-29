# Host-service migration / startup hardening

## Status

In progress on `host-service-lifecycle-bu`.

- **Reproduced** the mechanism via integration test
  (`packages/host-service/src/db/db.contention.node-test.ts`, run with
  `bun run test:integration:db` under Electron-as-node): real `createDb` + real
  0005 + a sibling process holding the write lock → ~5s stall → `SQLITE_BUSY` →
  swallowed → `host_settings` missing.
- **Landed (primary layer A + B + health window):**
  - `db.ts`: explicit `busy_timeout = 8000` + **fail closed** (throw instead of
    swallow). Confirmed safe — drizzle wraps all pending migrations in one
    `BEGIN/COMMIT` with `ROLLBACK`+rethrow, so a failure leaves the DB at its
    prior version (never half-applied).
  - `apps/desktop/.../host-service-utils.ts`: `HEALTH_POLL_TIMEOUT_MS`
    `10_000 → 20_000` so a recoverable ~8s stall isn't SIGKILLed before bind.
  - Test now asserts the fixed behavior (fail-closed on sustained contention;
    recovery when the lock clears within the timeout) + baseline. 3/3 green;
    host-service unit suite 691/0; typecheck + lint clean.
- **Not yet done (structural layer):** C (coordinator auto-recovery on spawn
  failure — incl. failing fast on child-exit instead of polling the full 20s),
  D (decouple migrating/ready from port bind), E (single-writer per org). These
  address the contention *source*, which remains unproven (see below).

## Problem

After the desktop 1.12.0 update (the first release to add a host-service DB
migration, `0005_host_settings_and_project_overrides`), some users' host-service
fails to come up cleanly. Reported symptom: terminals dead / "can't type"
anywhere, not fixed by app rollback, fixed by a full quit + relaunch.

### Code-confirmed fragilities (verified, with locations)

1. **No `busy_timeout`.** `createDb` sets only `journal_mode=WAL` and
   `foreign_keys=ON` (`packages/host-service/src/db/db.ts:13-15`). better-sqlite3
   throws `SQLITE_BUSY` on lock contention instead of waiting. `busy_timeout`
   appears nowhere in the repo.
2. **Migration failure is swallowed.** `migrate()` is wrapped in a catch that
   logs and returns the db anyway (`db.ts:23-27`), so the service can come up on
   a half-migrated DB (later `no such table host_settings`).
3. **`migrate()` blocks before the port binds.** `createApp` calls `createDb`
   synchronously (`app.ts:80`); the port isn't bound until `serve()`
   (`serve.ts:48` → `:93`). A slow migration is indistinguishable from a dead
   process to the only observer that exists during it.
4. **The readiness window kills slow startups with no recovery.** Coordinator
   polls `/trpc/health.check` for `HEALTH_POLL_TIMEOUT_MS = 10_000`
   (`host-service-utils.ts:8`), then SIGTERMs the child and throws
   (`host-service-coordinator.ts:423-430`). Nothing auto-escalates to `reset()`
   — it's only reachable via the tRPC router (manual). So a killed startup just
   respawns into the same condition: a loop.
5. **The swallow defeats existing design intent.** `serve.ts:94-96` + `:113-115`
   show startup throws are meant to reach `main().catch(... process.exit(1))`.
   Failing-closed already wires through; the catch in `db.ts` is what blocks it.

### NOT yet verified (confirm before claiming this fixes the specific incident)

- That `SQLITE_BUSY` actually fires and that **concurrent writers** exist on one
  org's `host.db`. This is the prior-session empirical diagnosis, not re-proven
  here, and the contention *source* is unproven in code.
- That drizzle wraps each migration file in a transaction (the basis for "a
  failed 0005 rolls back cleanly to 0004, so fail-closed is safe"). Verify in
  the installed drizzle-orm before relying on it.
- Symptom mapping: "can't type everywhere" = the restart-loop bucket (service
  never binds), which *requires* the stall/kill to be real. A half-migrated DB
  alone would break settings/project-overrides, not typing.

### Step 0 — confirm the trigger first

Before/with the fix, pull a broken user's log and bucket it:

```
grep -nE "host-service\] (starting|listening)|Migration failed" ~/.superset/host/*/host-service.log
```

- Bucket A: `Migration failed` then `listening` → half-migrated (factors 1+2).
- Bucket B: many `starting`, no `listening`, no `Migration failed` → restart
  loop / killed mid-migration (factors 3+4). This is the "can't type" bucket.

This tells us which layers actually bit, and lets us assert the fix resolves it.

## Fix

Layered. Primary layer stops the bleeding and is high-confidence; structural
layer removes the failure mode by construction.

### Primary (resilience + correctness) — `db.ts` + coordinator

**A. `busy_timeout` + bounded retry around `migrate()`** (`db.ts`)
- Add `sqlite.pragma("busy_timeout = 15000")`.
- Retry `migrate()` up to ~3× with backoff, retrying only on
  `SQLITE_BUSY`/`SQLITE_LOCKED`.

**B. Stop swallowing — fail closed** (`db.ts`)
- If `migrate()` still fails after retries, **throw**. Confirm drizzle's
  per-migration transaction first (above) so a rolled-back 0005 leaves a clean
  0004 DB. The throw propagates `createApp → main().catch → exit(1)`, so the
  coordinator's health poll fails instead of serving a broken DB.

**C. Auto-escalate a failed spawn to `reset()`** (`host-service-coordinator.ts`)
- On `pollHealthCheck` failure in `spawn()`, run `reset()` once (SIGKILL the
  manifest pid + remove manifest + respawn) before giving up. Clears a stale
  lock-holder automatically instead of looping. Guard against infinite
  escalation (one reset attempt, then surface the error).

**Numeric interaction (must get right):** with migrate-before-bind, a 15s
`busy_timeout` exceeds the 10s health window — B/C would just convert a
half-migration into a clean kill at 10s. So **either** raise the health budget
above `busy_timeout` + expected migration time, **or** land the structural fix
(D) which removes the window's relevance. Don't ship A/B/C without one of these.

### Structural (removes factors 3 & 4) — request lifecycle

**D. Decouple "alive / migrating" from "ready."**
- Bind the port first; run migration in the background; track
  `dbState: "migrating" | "ready" | "failed"`.
- `health.check` reports the state. DB-touching routes return `503 starting`
  while `migrating` (fits optimistic-render direction — renderer shows
  "starting", terminals connect once ready).
- Coordinator polls until `ready` or child-exit (fail fast), generous budget;
  treats `migrating` as alive. Removes the kill-mid-migration mode entirely.

**E. Single-writer guarantee per org (root of the contention).**
- In `spawn()`, before start: if `readManifest(org)?.pid` is alive and not an
  instance we own, SIGKILL + await exit before spawning, so two processes never
  race the same `host.db`.
- Backstop: `BEGIN EXCLUSIVE` around `migrate()` so a slipped-through second
  process waits (under `busy_timeout`) and no-ops on an already-migrated DB.

## Verification

- Unit: `createDb` retries on `SQLITE_BUSY` and throws after exhausting retries
  (mutate to prove the test catches both).
- Integration: hold an exclusive lock on a temp `host.db`, start host-service,
  assert it waits then succeeds (with A) / exits non-zero (B, if held past
  retries) rather than serving a broken DB.
- Coordinator: simulate a stale live manifest pid; assert `spawn()` escalates to
  `reset()` and recovers (C), and that single-writer (E) kills the stale pid.
- Regression: with D, assert routes 503 during migration and the coordinator
  does not SIGKILL within the old 10s window.

## Sequencing

1. Step 0 (log triage) — confirm bucket, in parallel with build.
2. Confirm drizzle per-migration transaction behavior.
3. Land **A + B + C** with the health-budget bump — small, high-confidence;
   converts "permanent brick" → "self-heals on next launch."
4. Land **D + E** as the durable follow-up that makes update-time contention
   impossible.

## Risks / open questions

- If the real trigger is NOT contention, A/B/C still harden startup but won't
  explain Roshvan's incident — hence Step 0.
- `reset()` escalation (C) must be bounded to avoid a SIGKILL/respawn loop.
- D changes the readiness contract; audit callers that assume DB-ready on first
  successful health check.
