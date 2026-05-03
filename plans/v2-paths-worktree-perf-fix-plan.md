# V2 paths — worktree-scaling perf fix plan

**Branch:** `v2-paths-worktree-perf`
**Date:** 2026-05-02
**Companion doc:** [`v2-paths-worktree-perf-findings.md`](./v2-paths-worktree-perf-findings.md)

This plan addresses the steady-state worktree-scaling costs identified in the findings audit. The goal: host-service idle CPU and JS heap should be roughly **flat** as worktree count grows, not linear.

Each fix has a verification step against the existing reproduction tests / benchmarks. After all fixes land, those benchmarks should show the post-fix numbers cited in the "target" rows.

---

## Fix order

| # | Fix | Severity | Effort | Where | Status |
|---|-----|----------|--------|-------|--------|
| 1 | Event-driven `pull-requests` runtime via `GitWatcher.onChanged` | 🔴 CRITICAL | Medium | `packages/host-service` | pending |
| 2 | LRU + idle-TTL cap on `searchIndexCache` | 🔴 IMPORTANT | Small | `packages/workspace-fs` | ✅ landed |
| 3 | LRU cap on per-watcher `pathTypes` | 🔴 IMPORTANT | Small | `packages/workspace-fs` | ✅ landed |
| 4 | Loosen `refreshEligibleProjects` to 5-min safety net | 🟡 LOW | Trivial | `packages/host-service` | pending (after #1) |
| 5 | (Deferred) Lazy GitWatcher registration | ⚪ DEFER | Large | `packages/host-service` | deferred |

### Measured impact of landed fixes (#2 + #3)

Re-running `cache-and-paths-memory.bench.test.ts` after the caps:

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| Heap @ 130 cached worktree indexes | +6.87 MB | +2.02 MB | 71% |
| Heap @ 20k unique paths in `pathTypes` | +8.69 MB | +2.54 MB | 71% |
| `pathTypes.size` @ 20k unique paths | 20,000 | 10,000 (capped) | hard cap |
| `searchIndexCache` retained entries @ 130 worktrees | 130 (linear) | 12 (cap) | hard cap |

Order matters: #1 unblocks #4, and the structural argument for #5 weakens significantly once #1–#3 land. Do #1–#4 first; reassess #5 after measuring.

---

## Fix 1 — Event-driven `pull-requests` runtime

**Goal:** turn the unconditional 30s `syncWorkspaceBranches` polling into a `git:changed` subscription, so idle ticks cost ~0 git subprocesses regardless of worktree count.

### Changes

1. **Inject `GitWatcher` into `PullRequestRuntimeManager`** — extend `PullRequestRuntimeManagerOptions` with a `gitWatcher: GitWatcher` field. Wire it through `packages/host-service/src/app.ts:85+` where the runtime is constructed alongside the existing `GitWatcher`.

2. **Replace the polling timer in `start()`** (`packages/host-service/src/runtime/pull-requests/pull-requests.ts:218-230`):

   ```ts
   start() {
       if (this.unsubscribeFromGitWatcher) return;

       // One initial sweep so existing workspaces have correct branch/sha/upstream
       // even if no .git/ changes have happened since the last process start.
       void this.syncWorkspaceBranches();
       void this.refreshEligibleProjects();

       // Steady-state: react to real .git/ changes per workspace.
       this.unsubscribeFromGitWatcher = this.gitWatcher.onChanged((event) => {
           void this.syncOneWorkspace(event.workspaceId);
       });

       // Long-cadence safety net for events the watcher might miss
       // (overflow, fs.watch errors). 5 min, not 30 s.
       this.safetyNetTimer = setInterval(
           () => void this.syncWorkspaceBranches(),
           SAFETY_NET_INTERVAL_MS,
       );
   }
   ```

3. **Add `syncOneWorkspace(workspaceId)`** — the existing `syncWorkspaceBranches` loop body (lines 310–356) extracted to operate on a single workspace by id. Reuses every existing helper (`getCurrentBranchName`, `getHeadSha`, `resolveWorkspaceUpstream`).

4. **Drop `BRANCH_SYNC_INTERVAL_MS = 30_000`**, add `SAFETY_NET_INTERVAL_MS = 5 * 60_000`. The 30 s timer goes away.

5. **`stop()`** unsubscribes from the GitWatcher and clears the safety-net timer.

### Why this is safe

- `GitWatcher` already debounces `.git/` changes per workspace at 300 ms (`git-watcher.ts:12, 136-162`). Branch / HEAD / upstream changes always touch `.git/` (refs, HEAD pointer, config), so this catches everything `syncWorkspaceBranches` catches today, with **lower** latency (300 ms vs 30 s).
- The 5-min safety net handles the rare overflow/error path where `GitWatcher` resets a watcher and might miss an event.
- Initial `syncWorkspaceBranches` call on `start()` ensures workspaces created before the runtime started are caught up.

### Verification

- **`pull-requests-scaling.integration.test.ts`** — the second-tick assertion (`expect(totalAfterTwoTicks).toBe(firstTickCount * 2)`) should INVERT: after the fix, calling `syncOneWorkspace` for a workspace with no `.git/` changes still issues git ops (one workspace), but the steady-state event loop only fires when `.git/` changes. Add a new test: register the runtime with a `GitWatcher` against a real git fixture, then `git commit` in one repo and assert *only that* workspace's git-op counter incremented.
- **`pull-requests-scaling.bench.test.ts`** — re-run after fix; the "steady ms" column should drop to ~0 ms because the second tick measurement no longer corresponds to anything the runtime does. Replace the benchmark with one that measures "ms per real branch change," not "ms per polling tick."

### Target numbers

| Scenario | Before | After |
|----------|--------|-------|
| Idle tick @ N=20 worktrees | 1542 ms (80 git ops) | 0 ms (0 git ops) |
| Single branch change @ any N | ≤ 30 s wait + ~80 ms work | ~300 ms wait + ~80 ms work |
| Daily git subprocess count @ N=20 | ~230k | proportional to actual branch changes (~10s–100s/day) |

---

## Fix 2 — LRU + idle-TTL cap on `searchIndexCache`

**Goal:** bound JS heap growth by capping the number of cached worktree indexes and evicting idle entries.

### Changes

In `packages/workspace-fs/src/search.ts:100`:

```ts
const SEARCH_INDEX_CACHE_MAX = 12;
const SEARCH_INDEX_CACHE_TTL_MS = 30 * 60_000;

interface CachedIndex {
    items: SearchIndexEntry[];
    lastAccessedAt: number;
}

// Replace plain Map with an LRU + TTL.
const searchIndexCache = new Map<string, CachedIndex>();

function evictStaleEntries(): void {
    const now = Date.now();
    for (const [key, cached] of searchIndexCache) {
        if (now - cached.lastAccessedAt > SEARCH_INDEX_CACHE_TTL_MS) {
            searchIndexCache.delete(key);
        }
    }
}

function evictLruIfFull(): void {
    while (searchIndexCache.size >= SEARCH_INDEX_CACHE_MAX) {
        // Map iteration is insertion-order; LRU bump moves entries to the end
        // (delete + set). The first key in the Map is the least-recently-used.
        const oldestKey = searchIndexCache.keys().next().value;
        if (!oldestKey) break;
        searchIndexCache.delete(oldestKey);
    }
}
```

In `getSearchIndex` (lines 272–300):
- On hit, `delete` then re-`set` the entry to bump it to most-recently-used in insertion order, and update `lastAccessedAt`.
- On miss, after `buildSearchIndex` resolves, run `evictLruIfFull()` before inserting; opportunistically `evictStaleEntries()` too.

`patchSearchIndexesForRoot` and `invalidateSearchIndex*` need minor updates to read/write the `CachedIndex` shape.

### Why this is safe

- `patchSearchIndexesForRoot` from the file watcher keeps the active worktree's index current — no behavior change for active worktrees.
- After eviction, the next search for that worktree pays a fresh `fast-glob` walk (~50–200 ms for a 5k-file repo). That's acceptable cold-cost for a worktree the user hasn't searched in 30 minutes.
- `searchIndexBuilds` (line 101) already deduplicates concurrent builds; eviction can race with an in-flight build, but the deduplication map handles it.

### Verification

- **`search-cache-no-eviction.test.ts`** — flip the assertions: after building 13 indexes, the *first* one should NOT be `===` to its initial reference (it got evicted). The "100 newer worktrees" test should fail-as-designed. Update the test name to `search-cache-eviction.test.ts` and rewrite assertions.
- **`cache-and-paths-memory.bench.test.ts`** — re-run; heap delta at 130 worktrees should drop from ~6.87 MB to whatever 12 worktrees × ~53 KB ≈ 0.6 MB.

### Target numbers

| Scenario | Before | After |
|----------|--------|-------|
| Heap @ 130 cached indexes | +6.87 MB | +0.6 MB (only 12 retained) |
| Heap growth rate | linear in N | bounded by cap |
| Cold-search latency on evicted worktree | n/a | +50–200 ms |

---

## Fix 3 — LRU cap on per-watcher `pathTypes`

**Goal:** stop unbounded growth of `WatcherState.pathTypes` when worktrees see continuous unique-path creation (logs, hashed build artifacts).

### Changes

In `packages/workspace-fs/src/watch.ts:32-39, 472-484`:

```ts
const PATH_TYPES_MAX = 10_000;

interface WatcherState {
    // ...existing fields...
    pathTypes: Map<string, boolean>;
}

// In normalizeEvent (line 467-491):
if (event.type === "delete") {
    state.pathTypes.delete(absolutePath);
} else {
    try {
        const stats = await stat(absolutePath);
        isDirectory = stats.isDirectory();

        // LRU bump: re-insertion moves to most-recently-used position.
        state.pathTypes.delete(absolutePath);
        if (state.pathTypes.size >= PATH_TYPES_MAX) {
            const oldest = state.pathTypes.keys().next().value;
            if (oldest) state.pathTypes.delete(oldest);
        }
        state.pathTypes.set(absolutePath, isDirectory);
    } catch {
        isDirectory = state.pathTypes.get(absolutePath) ?? false;
    }
}
```

### Why this is safe

- `pathTypes` is a directory-type hint to avoid `stat()` on every event for the same path. Evicting an entry means the next event for that path falls into the existing `try { await stat() } catch` branch — i.e., the existing slow path, not a bug.
- The cap is per-watcher, so the worst case is one worktree thrashing its own cache while others are unaffected.

### Verification

- **`watch-pathtypes-growth.test.ts`** — the "30 unique paths" test still passes (30 < cap). Add a new test: create 10,001 unique paths and assert `pathTypes.size === 10_000` with the oldest entry evicted.
- **`cache-and-paths-memory.bench.test.ts`** — at 20k unique paths, heap should plateau at ~5 MB (10k entries × ~430 bytes) instead of climbing to ~9 MB.

### Target numbers

| Scenario | Before | After |
|----------|--------|-------|
| `pathTypes.size` after 20k unique paths | 20,000 | 10,000 (capped) |
| Heap @ 20k paths | +8.69 MB | +4.3 MB (capped) |
| Daily heap growth @ 20 active worktrees | ~85 MB/day | bounded ~85 MB total |

---

## Fix 4 — Loosen `refreshEligibleProjects` to 5-min safety net

**Goal:** drop the constant 20s ticking once Fix 1 makes branch changes event-driven.

### Changes

In `packages/host-service/src/runtime/pull-requests/pull-requests.ts:25-26`:

```ts
const PROJECT_REFRESH_INTERVAL_MS = 5 * 60_000; // was 20_000
```

Optionally, drop the timer entirely and rely on `refreshProject` calls from `syncOneWorkspace` (Fix 1) to keep the GraphQL cache warm. The 60s repo-PR cache (line 32) already absorbs duplicate fetches.

### Why this is safe

- Fix 1's event-driven `syncOneWorkspace` calls `refreshProject` whenever a branch change is detected, so PR state for active workspaces stays current without polling.
- The 5-min safety net catches PRs opened on GitHub without a corresponding local branch change (rare — the local fetch would trigger `git:changed`).

### Verification

- No new tests required. Existing `pull-requests.test.ts` integration tests should still pass.
- The host-service idle CPU profile should show no measurable activity in the runtime when no workspaces have `.git/` activity.

---

## Fix 5 — (Deferred) Lazy GitWatcher registration

After Fixes 1–3 land, re-measure idle host-service CPU and RSS at N=20 worktrees. If they're already flat, this fix is unnecessary — the per-watcher native cost is small in the absence of file events.

If they're not flat (e.g. background dev servers in many worktrees still cause measurable wakeups), revisit by:
- Adding a refcount to `GitWatcher.watchWorkspace` keyed on subscriber count.
- Generalizing the `bus.watchFs(workspaceId)` pattern from `apps/desktop/src/renderer/hooks/host-service/useWorkspaceEvent/useWorkspaceEvent.ts:73-83` to git events.
- BUT: the pull-requests runtime (post-Fix-1) is itself a subscriber to all workspaces' `git:changed`, so refcount-based laziness needs a way to skip the runtime's "always-on" subscription, or the runtime needs to subscribe lazily based on PR-tracked workspaces only.

This is a meaningful refactor; defer until measurements justify it.

---

## Sequencing & rollout

These fixes are internal to host-service / workspace-fs and don't touch the renderer or any tRPC contracts. No feature flags required. Land them as separate PRs in this order:

1. **Fix 2 + 3 first** (workspace-fs LRU caps) — small, isolated, no behavior change for active worktrees, easy to revert. Get the "memory creep stops" win quickly.
2. **Fix 1** (event-driven pull-requests) — bigger change, depends on `GitWatcher` already being constructed in `app.ts` (it is). Verify with the existing integration tests + a new "real branch change triggers single-workspace sync" test.
3. **Fix 4** — one-line change after #1 lands. Bundle with #1's PR if the integration test for #1 demonstrates the project refresh fan-out is no longer hot.

Each PR should re-run the corresponding benchmark from the findings doc and paste the before/after numbers in the description.

---

## Out of scope

- **Renderer-side `useDiffStats` fan-out** — already demoted to "boot/mount cost" in the findings audit. If sidebar-mount latency becomes a complaint, add a `git.getDiffStats` host endpoint that returns just `git diff --shortstat HEAD` per workspace, and switch `useDiffStats` to it. Separate effort.
- **`useChangesTab` / `useReviewTab` / `usePRFlowState` 10–30s `refetchInterval`s** — verified to fire only for the active workspace, not per-worktree. No change.

---

## Acceptance criteria

After Fixes 1–4 land:

- `pull-requests-scaling.integration.test.ts` "idle tick" test inverts: zero git ops on a tick where no `.git/` changed.
- `pull-requests-scaling.bench.test.ts` reports ~0 ms steady-state cost (replaced with "ms per real change").
- `cache-and-paths-memory.bench.test.ts` reports plateau heap deltas (~0.6 MB cache cap, ~4.3 MB pathTypes cap) regardless of input size.
- Manual smoke: open 20 worktrees, leave the host-service idle for 10 minutes, verify CPU baseline is ≤ 1% and RSS is stable.
