import { afterEach, describe, test } from "bun:test";
import simpleGit, { type SimpleGit } from "simple-git";
import type { HostDb } from "../../src/db";
import { PullRequestRuntimeManager } from "../../src/runtime/pull-requests/pull-requests";
import { createTestHost, type TestHost } from "../helpers/createTestHost";
import { createGitFixture, type GitFixture } from "../helpers/git-fixture";
import { seedProject, seedWorkspace } from "../helpers/seed";

/**
 * BENCHMARK companion to `pull-requests-scaling.integration.test.ts`.
 *
 * Real wall-clock numbers for `syncWorkspaceBranches` at N ∈ {1, 5, 20}
 * worktrees so the over-time cost can be quoted in milliseconds, not just
 * "O(N) git ops." Real DB, real git repos, real `simple-git` subprocesses.
 *
 * This file exists so claims like "with 20 worktrees, idle ticks burn X ms
 * every 30s" are anchored to a measurement, not extrapolation. Output goes
 * through `console.log`; assertions are minimal so the benchmark doesn't
 * fail on slow CI runners.
 */

interface OpCounter {
	count: number;
}

function instrumentGit(realGit: SimpleGit, counter: OpCounter): SimpleGit {
	return new Proxy(realGit, {
		get(target, prop, receiver) {
			if (prop === "raw" || prop === "revparse" || prop === "remote") {
				return (args: string[]) => {
					counter.count++;
					// biome-ignore lint/suspicious/noExplicitAny: dispatching on a known SimpleGit method
					return (target as any)[prop](args);
				};
			}
			return Reflect.get(target, prop, receiver);
		},
	});
}

interface BenchScenario {
	host: TestHost;
	repos: GitFixture[];
	manager: PullRequestRuntimeManager;
	counter: OpCounter;
	dispose: () => Promise<void>;
}

async function setup(workspaceCount: number): Promise<BenchScenario> {
	const host = await createTestHost();
	const repos: GitFixture[] = [];

	for (let i = 0; i < workspaceCount; i++) {
		const repo = await createGitFixture();
		repos.push(repo);
		const { id: projectId } = seedProject(host, { repoPath: repo.repoPath });
		const headSha = (await repo.git.revparse(["HEAD"])).trim();
		seedWorkspace(host, {
			projectId,
			worktreePath: repo.repoPath,
			branch: "main",
			headSha,
		});
	}

	const counter: OpCounter = { count: 0 };
	const manager = new PullRequestRuntimeManager({
		db: host.db as HostDb,
		git: async (worktreePath: string) =>
			instrumentGit(simpleGit(worktreePath), counter),
		github: async () => ({}) as never,
	});

	(
		manager as unknown as { refreshProject: () => Promise<void> }
	).refreshProject = async () => undefined;

	const dispose = async () => {
		for (const repo of repos) repo.dispose();
		await host.dispose();
	};

	return { host, repos, manager, counter, dispose };
}

async function runOneTick(scenario: BenchScenario): Promise<void> {
	await (
		scenario.manager as unknown as {
			syncWorkspaceBranches: () => Promise<void>;
		}
	).syncWorkspaceBranches();
}

describe("BENCH: syncWorkspaceBranches wall-clock vs N", () => {
	let scenarios: BenchScenario[] = [];

	afterEach(async () => {
		await Promise.all(scenarios.map((s) => s.dispose()));
		scenarios = [];
	});

	test("prints ms-per-tick for N ∈ {1, 5, 20}", async () => {
		const sizes = [1, 5, 20];
		const rows: Array<{
			n: number;
			warmupMs: number;
			measuredMs: number;
			ops: number;
			msPerOp: number;
		}> = [];

		for (const n of sizes) {
			const scenario = await setup(n);
			scenarios.push(scenario);

			// Warmup: first tick may pay JIT / disk-cache costs.
			const t0 = performance.now();
			await runOneTick(scenario);
			const warmupMs = performance.now() - t0;
			const warmupOps = scenario.counter.count;

			// Measured: second tick is the steady-state cost — same wasted work,
			// caches are hot, so this is the true recurring overhead.
			scenario.counter.count = 0;
			const t1 = performance.now();
			await runOneTick(scenario);
			const measuredMs = performance.now() - t1;
			const ops = scenario.counter.count;

			rows.push({
				n,
				warmupMs: +warmupMs.toFixed(1),
				measuredMs: +measuredMs.toFixed(1),
				ops,
				msPerOp: +(measuredMs / ops).toFixed(2),
			});

			// Discard warmup numbers from final report unless they're way off.
			void warmupOps;
		}

		console.log("\n=== syncWorkspaceBranches wall-clock benchmark ===");
		console.log("N\twarmup ms\tsteady ms\tgit ops\tms/op\tprojected/30s");
		for (const r of rows) {
			console.log(
				`${r.n}\t${r.warmupMs}\t\t${r.measuredMs}\t\t${r.ops}\t${r.msPerOp}\t${r.measuredMs.toFixed(0)}ms / 30s tick`,
			);
		}

		// Extrapolate to common worktree counts the user might have.
		const last = rows[rows.length - 1];
		if (last) {
			const msPerWorkspace = last.measuredMs / last.n;
			console.log(
				`\nExtrapolation @ ${msPerWorkspace.toFixed(1)} ms/workspace/tick:`,
			);
			for (const projN of [50, 100]) {
				const projectedMs = msPerWorkspace * projN;
				const projectedDailyMs = projectedMs * 2 * 60 * 24; // 2 ticks/min × 60min × 24h
				console.log(
					`  N=${projN}: ~${projectedMs.toFixed(0)}ms/tick, ~${(projectedDailyMs / 1000).toFixed(0)}s/day of pure git-subprocess waste`,
				);
			}
		}
		console.log("===\n");
	}, 60_000);
});
