import { afterEach, describe, expect, test } from "bun:test";
import simpleGit, { type SimpleGit } from "simple-git";
import type { HostDb } from "../../src/db";
import { GitWatcher } from "../../src/events/git-watcher";
import { WorkspaceFilesystemManager } from "../../src/runtime/filesystem";
import { PullRequestRuntimeManager } from "../../src/runtime/pull-requests/pull-requests";
import { createTestHost, type TestHost } from "../helpers/createTestHost";
import { createGitFixture, type GitFixture } from "../helpers/git-fixture";
import { seedProject, seedWorkspace } from "../helpers/seed";

/**
 * INTEGRATION coverage for finding #1 in
 * `plans/v2-paths-worktree-perf-findings.md`.
 *
 * Two scenarios:
 *
 * 1. **Safety-net sweep cost** — exercises `syncWorkspaceBranches` directly
 *    (the long-cadence backup that runs every 5 min after the fix). Confirms
 *    the per-workspace cost is constant: ~3 git subprocesses per workspace,
 *    regardless of N. This is the cost the safety net pays *if it fires*.
 *
 * 2. **Event-driven steady state** — wires a real `GitWatcher` into the
 *    runtime, lets the initial sweep settle, then fires a single real
 *    `git commit` in one workspace. Asserts that ONLY that workspace's
 *    sync runs — the other N-1 stay quiet. This is the post-fix steady
 *    state: idle workspaces do zero git work.
 *
 * Uses real bun:sqlite via createTestHost, real on-disk git repos via
 * createGitFixture, and real `simple-git` subprocesses. Instrumentation
 * lives at the `GitFactory` boundary so the count is faithful.
 */

interface GitOpLog {
	worktreePath: string;
	method: "raw" | "revparse" | "remote";
	args: string[];
}

function instrumentGit(
	realGit: SimpleGit,
	log: GitOpLog[],
	worktreePath: string,
): SimpleGit {
	// Wrap only the methods syncWorkspaceBranches actually exercises. Other
	// SimpleGit methods are passed through untouched so the wrapper is a
	// drop-in replacement and we don't accidentally hide other callers.
	const proxied = new Proxy(realGit, {
		get(target, prop, receiver) {
			if (prop === "raw" || prop === "revparse" || prop === "remote") {
				return (args: string[]) => {
					log.push({
						worktreePath,
						method: prop as GitOpLog["method"],
						args: [...args],
					});
					// biome-ignore lint/suspicious/noExplicitAny: dispatching on a known SimpleGit method
					return (target as any)[prop](args);
				};
			}
			return Reflect.get(target, prop, receiver);
		},
	});
	return proxied;
}

interface ScalingScenario {
	host: TestHost;
	repos: GitFixture[];
	workspaceIds: string[];
	gitOpLog: GitOpLog[];
	manager: PullRequestRuntimeManager;
	dispose: () => Promise<void>;
}

async function createScalingScenario(
	workspaceCount: number,
): Promise<ScalingScenario> {
	const host = await createTestHost();
	const repos: GitFixture[] = [];
	const workspaceIds: string[] = [];

	for (let i = 0; i < workspaceCount; i++) {
		const repo = await createGitFixture();
		repos.push(repo);
		const { id: projectId } = seedProject(host, {
			repoPath: repo.repoPath,
		});
		// Seed the workspace row with the same branch / sha the freshly-init'd
		// repo will have so syncWorkspaceBranches sees "no change" — that's the
		// realistic steady-state where every tick is wasteful.
		const headSha = await repo.git.revparse(["HEAD"]);
		const { id } = seedWorkspace(host, {
			projectId,
			worktreePath: repo.repoPath,
			branch: "main",
			headSha: headSha.trim(),
		});
		workspaceIds.push(id);
	}

	const gitOpLog: GitOpLog[] = [];
	const manager = new PullRequestRuntimeManager({
		db: host.db as HostDb,
		git: async (worktreePath: string) => {
			return instrumentGit(simpleGit(worktreePath), gitOpLog, worktreePath);
		},
		github: async () => ({}) as never,
		gitWatcher: { onChanged: () => () => {} } as never,
	});

	// Stub refreshProject — we want to isolate the per-workspace git cost,
	// not the project-level GraphQL fan-out (which has its own 60s cache and
	// a separate finding #4).
	(
		manager as unknown as { refreshProject: () => Promise<void> }
	).refreshProject = async () => undefined;

	const dispose = async () => {
		for (const repo of repos) repo.dispose();
		await host.dispose();
	};

	return { host, repos, workspaceIds, gitOpLog, manager, dispose };
}

describe("syncWorkspaceBranches safety-net sweep — integration scaling", () => {
	let scenarios: ScalingScenario[] = [];

	afterEach(async () => {
		await Promise.all(scenarios.map((s) => s.dispose()));
		scenarios = [];
	});

	test("real git subprocess count grows linearly with workspace count", async () => {
		const small = await createScalingScenario(2);
		scenarios.push(small);
		await (
			small.manager as unknown as {
				syncWorkspaceBranches: () => Promise<void>;
			}
		).syncWorkspaceBranches();

		const large = await createScalingScenario(5);
		scenarios.push(large);
		await (
			large.manager as unknown as {
				syncWorkspaceBranches: () => Promise<void>;
			}
		).syncWorkspaceBranches();

		// Each workspace gets the same fixed set of git calls per tick.
		const perWorkspaceSmall = small.gitOpLog.length / 2;
		const perWorkspaceLarge = large.gitOpLog.length / 5;
		expect(perWorkspaceSmall).toBe(perWorkspaceLarge);

		// Sanity: at least branch + HEAD + push-ref = 3 git ops per workspace.
		expect(perWorkspaceSmall).toBeGreaterThanOrEqual(3);

		// Linearity is the headline assertion.
		expect(large.gitOpLog.length).toBe((small.gitOpLog.length / 2) * 5);

		console.log(
			`[integration scaling] real git ops/tick: 2 workspaces=${small.gitOpLog.length}, 5 workspaces=${large.gitOpLog.length}, per-workspace=${perWorkspaceSmall}`,
		);
	});

	test("safety-net sweep does the same work on every invocation", async () => {
		// The safety-net runs every 5 min and always walks every workspace —
		// that's its job. Two invocations with no real git activity in between
		// should each pay the same cost. (After the fix, this only happens once
		// per 5 min instead of once per 30 s, but the per-call shape is the
		// same.)
		const scenario = await createScalingScenario(3);
		scenarios.push(scenario);

		await (
			scenario.manager as unknown as {
				syncWorkspaceBranches: () => Promise<void>;
			}
		).syncWorkspaceBranches();
		const firstTickCount = scenario.gitOpLog.length;

		await (
			scenario.manager as unknown as {
				syncWorkspaceBranches: () => Promise<void>;
			}
		).syncWorkspaceBranches();
		const totalAfterTwoTicks = scenario.gitOpLog.length;

		expect(totalAfterTwoTicks).toBe(firstTickCount * 2);

		const worktreesTouchedFirstTick = new Set(
			scenario.gitOpLog.slice(0, firstTickCount).map((c) => c.worktreePath),
		);
		expect(worktreesTouchedFirstTick.size).toBe(3);
	});
});

interface EventDrivenScenario {
	host: TestHost;
	repos: GitFixture[];
	workspaceIds: string[];
	gitOpLog: GitOpLog[];
	manager: PullRequestRuntimeManager;
	gitWatcher: GitWatcher;
	filesystem: WorkspaceFilesystemManager;
	dispose: () => Promise<void>;
}

async function createEventDrivenScenario(
	workspaceCount: number,
): Promise<EventDrivenScenario> {
	const host = await createTestHost();
	const repos: GitFixture[] = [];
	const workspaceIds: string[] = [];

	for (let i = 0; i < workspaceCount; i++) {
		const repo = await createGitFixture();
		repos.push(repo);
		const { id: projectId } = seedProject(host, { repoPath: repo.repoPath });
		const headSha = (await repo.git.revparse(["HEAD"])).trim();
		const { id } = seedWorkspace(host, {
			projectId,
			worktreePath: repo.repoPath,
			branch: "main",
			headSha,
		});
		workspaceIds.push(id);
	}

	const gitOpLog: GitOpLog[] = [];
	const filesystem = new WorkspaceFilesystemManager({ db: host.db as HostDb });
	const gitWatcher = new GitWatcher(host.db as HostDb, filesystem);

	const manager = new PullRequestRuntimeManager({
		db: host.db as HostDb,
		git: async (worktreePath: string) =>
			instrumentGit(simpleGit(worktreePath), gitOpLog, worktreePath),
		github: async () => ({}) as never,
		gitWatcher,
	});

	(
		manager as unknown as { refreshProject: () => Promise<void> }
	).refreshProject = async () => undefined;

	const dispose = async () => {
		manager.stop();
		gitWatcher.close();
		await filesystem.close();
		for (const repo of repos) repo.dispose();
		await host.dispose();
	};

	return {
		host,
		repos,
		workspaceIds,
		gitOpLog,
		manager,
		gitWatcher,
		filesystem,
		dispose,
	};
}

async function waitFor(
	predicate: () => boolean,
	{ timeoutMs = 5000, pollMs = 50 } = {},
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("Timed out waiting for predicate");
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
}

/**
 * Wait until `getValue()` stops growing for `quietMs` consecutive ms — i.e.
 * the system has settled. We need this when the initial sweep + concurrent
 * GitWatcher debounce flushes are still trickling in: a fixed-time sleep
 * after `start()` might snapshot mid-flush, leaving leftover ops to count
 * against later assertions.
 */
async function waitUntilQuiet(
	getValue: () => number,
	{ quietMs = 750, timeoutMs = 15_000, pollMs = 50 } = {},
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastValue = getValue();
	let lastChangeAt = Date.now();
	while (Date.now() - lastChangeAt < quietMs) {
		if (Date.now() > deadline) {
			throw new Error("Timed out waiting for system to quiesce");
		}
		await new Promise((r) => setTimeout(r, pollMs));
		const current = getValue();
		if (current !== lastValue) {
			lastValue = current;
			lastChangeAt = Date.now();
		}
	}
}

describe("PullRequestRuntimeManager event-driven steady state", () => {
	let scenarios: EventDrivenScenario[] = [];

	afterEach(async () => {
		await Promise.all(scenarios.map((s) => s.dispose()));
		scenarios = [];
	});

	test("git:changed in one workspace triggers a single-workspace sync, not a full sweep", async () => {
		const scenario = await createEventDrivenScenario(5);
		scenarios.push(scenario);

		// Initial start() does one full sweep + subscribes to GitWatcher.
		scenario.gitWatcher.start();
		scenario.manager.start();

		// Wait until the initial sweep AND any startup-related GitWatcher
		// events have fully drained — otherwise we'd snapshot mid-flush and
		// see leftover ops from another workspace counted as "event-driven".
		await waitFor(() => scenario.gitOpLog.length > 0, { timeout: 10_000 });
		await waitUntilQuiet(() => scenario.gitOpLog.length, {
			quietMs: 1_000,
			timeoutMs: 15_000,
		});
		const baselineLogLength = scenario.gitOpLog.length;

		// Commit in one workspace only.
		const targetIndex = 2;
		const targetRepo = scenario.repos[targetIndex];
		if (!targetRepo) throw new Error("missing target repo");
		await targetRepo.commit("event-driven change", {
			"event.txt": "trigger",
		});

		// GitWatcher debounces 300 ms; wait for sync to fire and then settle.
		await waitFor(() => scenario.gitOpLog.length > baselineLogLength, {
			timeout: 10_000,
		});
		await waitUntilQuiet(() => scenario.gitOpLog.length, {
			quietMs: 1_000,
			timeoutMs: 10_000,
		});

		const eventDrivenOps = scenario.gitOpLog.slice(baselineLogLength);
		const touchedWorktrees = new Set(
			eventDrivenOps.map((op) => op.worktreePath),
		);

		// Only the target workspace should have been synced.
		expect(touchedWorktrees.size).toBe(1);
		expect(touchedWorktrees.has(targetRepo.repoPath)).toBe(true);

		console.log(
			`[event-driven] commit in 1/${scenario.repos.length} workspaces → ${eventDrivenOps.length} git ops touching ${touchedWorktrees.size} worktree`,
		);
	}, 30_000);
});
