import { describe, expect, test } from "bun:test";
import { runWithPostCheckoutHookTolerance } from "./git-hook-tolerance";

describe("runWithPostCheckoutHookTolerance", () => {
	test("treats post-checkout hook failures as non-fatal when operation succeeded", async () => {
		const hookError = Object.assign(
			new Error("husky - post-checkout script failed"),
			{
				stderr: "husky - command not found in PATH=...",
			},
		);

		await expect(
			runWithPostCheckoutHookTolerance({
				context: "Switched branch",
				run: async () => {
					throw hookError;
				},
				didSucceed: async () => true,
			}),
		).resolves.toBeUndefined();
	});

	test("treats a SIGPIPE/exit-141 failure with no diagnostic output as non-fatal when the worktree was created", async () => {
		// A post-checkout hook pipeline that dies with SIGPIPE under `set -o
		// pipefail` surfaces as a non-zero exit with no "post-checkout"/"hook"
		// keywords at all — the case that regressed worktree creation (#4350).
		const sigpipeError = Object.assign(
			new Error("Command failed with exit code 141"),
			{ stderr: "" },
		);

		await expect(
			runWithPostCheckoutHookTolerance({
				context: "Worktree created at /tmp/wt",
				run: async () => {
					throw sigpipeError;
				},
				didSucceed: async () => true,
			}),
		).resolves.toBeUndefined();
	});

	test("re-throws failures when the intended outcome is absent", async () => {
		const hookError = new Error("post-checkout hook failed");

		await expect(
			runWithPostCheckoutHookTolerance({
				context: "Switched branch",
				run: async () => {
					throw hookError;
				},
				didSucceed: async () => false,
			}),
		).rejects.toThrow("post-checkout");
	});

	test("re-throws genuine git failures that never created the worktree", async () => {
		// A real `git worktree add` failure (e.g. branch already exists) aborts
		// before the worktree is registered, so didSucceed is false and the error
		// must propagate unchanged.
		const genericError = new Error("fatal: '../worktree' already exists");

		await expect(
			runWithPostCheckoutHookTolerance({
				context: "Created worktree",
				run: async () => {
					throw genericError;
				},
				didSucceed: async () => false,
			}),
		).rejects.toThrow("already exists");
	});

	test("re-throws the original error when the success check itself throws", async () => {
		const hookError = new Error("post-checkout hook failed");

		await expect(
			runWithPostCheckoutHookTolerance({
				context: "Worktree created at /tmp/wt",
				run: async () => {
					throw hookError;
				},
				didSucceed: async () => {
					throw new Error("git worktree list failed");
				},
			}),
		).rejects.toThrow("post-checkout hook failed");
	});
});
