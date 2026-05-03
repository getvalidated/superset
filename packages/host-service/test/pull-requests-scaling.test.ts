import { describe, expect, mock, test } from "bun:test";
import { PullRequestRuntimeManager } from "../src/runtime/pull-requests/pull-requests";

/**
 * Reproduces finding #1 from `plans/v2-paths-worktree-perf-findings.md`:
 *
 * `syncWorkspaceBranches` runs every 30s and spawns ~5 git subprocesses for
 * every workspace in the DB, regardless of whether anything changed. This
 * test proves the cost scales linearly with workspace count by counting the
 * git operations issued during a single tick, then asserting the per-tick
 * total grows in proportion to N.
 *
 * The "fix" (subscribing the runtime to `GitWatcher.onChanged`) should make
 * an idle tick cost O(1), not O(N).
 */

interface RawCallLog {
	worktreePath: string;
	args: string[];
}

function buildWorkspace(index: number) {
	return {
		id: `ws-${index}`,
		projectId: `project-${index}`,
		worktreePath: `/tmp/worktree-${index}`,
		// Match what the git mock will return so syncWorkspaceBranches treats
		// every workspace as unchanged. This is the realistic steady-state:
		// nothing changed, but we still pay full git-subprocess cost per tick.
		branch: "main",
		headSha: "deadbeef",
		upstreamOwner: "acme",
		upstreamRepo: "repo",
		upstreamBranch: "main",
		pullRequestId: null,
		createdAt: Date.now(),
	};
}

function buildGitMock(rawCalls: RawCallLog[], worktreePath: string) {
	const recordingRaw = mock(async (args: string[]) => {
		rawCalls.push({ worktreePath, args });

		// symbolic-ref --short HEAD → branch name
		if (args[0] === "symbolic-ref") return "main\n";

		// rev-parse --abbrev-ref BRANCH@{push} → push ref
		if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
			return "origin/main\n";
		}

		// remote get-url <name>
		if (args[0] === "remote" && args[1] === "get-url") {
			return "https://github.com/acme/repo.git\n";
		}

		// config --get <key>
		if (args[0] === "config") {
			return "";
		}

		throw new Error(`Unexpected raw args: ${args.join(" ")}`);
	});

	return {
		raw: recordingRaw,
		revparse: mock(async (args: string[]) => {
			rawCalls.push({ worktreePath, args: ["revparse", ...args] });
			if (args[0] === "HEAD") return "deadbeef\n";
			throw new Error(`Unexpected revparse args: ${args.join(" ")}`);
		}),
		remote: mock(async (args: string[]) => {
			rawCalls.push({ worktreePath, args: ["remote", ...args] });
			if (args[0] === "get-url") return "https://github.com/acme/repo.git\n";
			throw new Error(`Unexpected remote args: ${args.join(" ")}`);
		}),
	};
}

async function runSync(workspaceCount: number) {
	const workspaces = Array.from({ length: workspaceCount }, (_, i) =>
		buildWorkspace(i),
	);

	const rawCalls: RawCallLog[] = [];

	const db = {
		select: mock(() => ({
			from: mock(() => ({
				all: mock(() => workspaces),
			})),
		})),
		// syncWorkspaceBranches only writes when state changed; nothing should change here.
		update: mock(() => {
			throw new Error("update should not be called when state is unchanged");
		}),
	};

	const gitFactoryCalls: string[] = [];
	const git = mock(async (worktreePath: string) => {
		gitFactoryCalls.push(worktreePath);
		return buildGitMock(rawCalls, worktreePath);
	});

	const manager = new PullRequestRuntimeManager({
		db: db as never,
		git: git as never,
		github: async () => ({}) as never,
	});

	// `syncWorkspaceBranches` calls `refreshProject` only for changed projects;
	// stub it to a no-op so the test focuses purely on per-workspace git cost.
	(
		manager as unknown as {
			refreshProject: () => Promise<void>;
		}
	).refreshProject = mock(async () => undefined);

	await (
		manager as unknown as { syncWorkspaceBranches: () => Promise<void> }
	).syncWorkspaceBranches();

	return { rawCalls, gitFactoryCalls };
}

describe("syncWorkspaceBranches worktree-scaling", () => {
	test("git subprocess count grows linearly with workspace count (idle tick)", async () => {
		const small = await runSync(2);
		const large = await runSync(20);

		// One git factory invocation per workspace per tick
		expect(small.gitFactoryCalls.length).toBe(2);
		expect(large.gitFactoryCalls.length).toBe(20);

		// Each workspace issues the same fixed number of git ops on an unchanged
		// repo (branch lookup + HEAD + push-ref + remote URL). The exact count
		// is implementation-defined; what we assert is *linearity*: the cost
		// for 20 workspaces is 10× the cost for 2.
		const perWorkspaceSmall = small.rawCalls.length / 2;
		const perWorkspaceLarge = large.rawCalls.length / 20;
		expect(perWorkspaceSmall).toBe(perWorkspaceLarge);

		// Per-workspace cost is non-trivial — at least a branch lookup, HEAD,
		// and push-ref resolution. If this drops below 3 the runtime probably
		// dropped some git work and this scaling concern is partially fixed.
		expect(perWorkspaceSmall).toBeGreaterThanOrEqual(3);

		// Print the actual per-tick cost so the test output documents the
		// scaling factor for future readers.
		console.log(
			`[scaling] per-tick git ops: 2 workspaces=${small.rawCalls.length}, 20 workspaces=${large.rawCalls.length}, per-workspace=${perWorkspaceSmall}`,
		);
	});

	test("calls all N git factories even when zero workspaces changed", async () => {
		// The whole point of the scaling concern: even on a totally idle tick
		// (no branch / HEAD / upstream changes), every workspace pays the full
		// git-subprocess cost. This test pins that wasteful behavior.
		const { gitFactoryCalls, rawCalls } = await runSync(10);

		expect(gitFactoryCalls.length).toBe(10);
		expect(new Set(gitFactoryCalls).size).toBe(10);
		expect(rawCalls.length).toBeGreaterThanOrEqual(30); // ≥3 ops × 10 workspaces

		// Each workspace got its share of the work — no batching, no shortcut.
		const callsByWorktree = new Map<string, number>();
		for (const call of rawCalls) {
			callsByWorktree.set(
				call.worktreePath,
				(callsByWorktree.get(call.worktreePath) ?? 0) + 1,
			);
		}
		expect(callsByWorktree.size).toBe(10);
		for (const count of callsByWorktree.values()) {
			expect(count).toBeGreaterThanOrEqual(3);
		}
	});
});
