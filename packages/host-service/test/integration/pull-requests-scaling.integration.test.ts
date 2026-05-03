import { afterEach, describe, expect, test } from "bun:test";
import simpleGit, { type SimpleGit } from "simple-git";
import type { HostDb } from "../../src/db";
import { PullRequestRuntimeManager } from "../../src/runtime/pull-requests/pull-requests";
import { createTestHost, type TestHost } from "../helpers/createTestHost";
import { createGitFixture, type GitFixture } from "../helpers/git-fixture";
import { seedProject, seedWorkspace } from "../helpers/seed";

/**
 * INTEGRATION reproduction of finding #1 in
 * `plans/v2-paths-worktree-perf-findings.md`.
 *
 * Uses the real host-service test harness (real bun:sqlite DB via
 * createTestHost, real on-disk git repos via createGitFixture, real
 * `simple-git` subprocesses) and only instruments at the `GitFactory`
 * boundary to count git operations per `syncWorkspaceBranches` tick.
 *
 * Confirms end-to-end that:
 *   - Each tick spawns N real `simple-git` instances (one per workspace).
 *   - Each instance issues 3+ git subprocess calls — even when nothing
 *     changed in any repo since the last tick.
 *   - The per-workspace cost is constant, so the per-tick cost grows
 *     linearly with workspace count.
 *
 * The "fix" (subscribing the runtime to `GitWatcher.onChanged`) should
 * make this test fail: idle ticks should issue O(1) git calls, not O(N).
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

describe("syncWorkspaceBranches integration scaling", () => {
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

	test("idle tick still issues git calls for every workspace", async () => {
		// Pin the "wasted work" claim: when nothing has changed in any repo,
		// every workspace still gets its full git-ops quota. This is the
		// behavior the GitWatcher-driven fix should eliminate.
		const scenario = await createScalingScenario(3);
		scenarios.push(scenario);

		await (
			scenario.manager as unknown as {
				syncWorkspaceBranches: () => Promise<void>;
			}
		).syncWorkspaceBranches();
		const firstTickCount = scenario.gitOpLog.length;

		// Run a second tick with no fs/git activity in between.
		await (
			scenario.manager as unknown as {
				syncWorkspaceBranches: () => Promise<void>;
			}
		).syncWorkspaceBranches();
		const totalAfterTwoTicks = scenario.gitOpLog.length;

		// Second tick paid the same cost despite nothing changing.
		expect(totalAfterTwoTicks).toBe(firstTickCount * 2);

		// Each tick touched all 3 worktrees — no shortcut, no cache.
		const worktreesTouchedFirstTick = new Set(
			scenario.gitOpLog.slice(0, firstTickCount).map((c) => c.worktreePath),
		);
		expect(worktreesTouchedFirstTick.size).toBe(3);
	});
});
