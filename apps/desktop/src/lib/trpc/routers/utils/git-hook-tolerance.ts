interface GitCommandException extends Error {
	stdout?: string;
	stderr?: string;
}

function getErrorText(error: unknown): string {
	if (error instanceof Error) {
		const parts = [error.message];
		const gitError = error as GitCommandException;
		if (typeof gitError.stderr === "string" && gitError.stderr.trim()) {
			parts.push(gitError.stderr);
		}
		if (typeof gitError.stdout === "string" && gitError.stdout.trim()) {
			parts.push(gitError.stdout);
		}
		return parts.join("\n");
	}

	return String(error);
}

/**
 * Runs a git command whose checkout step may fire hooks (e.g. `post-checkout`),
 * tolerating a non-zero exit when the intended end-state was actually reached.
 *
 * `git worktree add` and branch checkout run the repo's `post-checkout` hook
 * AFTER the worktree is created and the branch is checked out. A flaky hook can
 * exit non-zero — sometimes with no identifying diagnostic output at all, e.g. a
 * pipeline that dies with SIGPIPE / exit 141 (`git worktree list | awk '…exit'`
 * under `set -o pipefail`) — even though git already finished its work.
 *
 * We deliberately do NOT try to recognise hook failures by matching stderr text:
 * a SIGPIPE death produces none of the usual keywords, so any such heuristic is
 * under-inclusive and rethrows over a worktree that is fully present on disk
 * (see issue #4350). Instead we ask `didSucceed` whether the concrete outcome we
 * wanted is real (worktree registered in `git worktree list` / branch switched).
 * If it is, the non-zero exit is non-fatal. If it isn't, the error is genuine
 * and we rethrow it unchanged.
 */
export async function runWithPostCheckoutHookTolerance({
	run,
	didSucceed,
	context,
}: {
	run: () => Promise<void>;
	didSucceed: () => Promise<boolean>;
	context: string;
}): Promise<void> {
	try {
		await run();
	} catch (error) {
		let succeeded = false;
		try {
			succeeded = await didSucceed();
		} catch {
			succeeded = false;
		}

		if (!succeeded) {
			throw error;
		}

		const message = getErrorText(error);
		console.warn(
			`[git] ${context} but the command exited non-zero (non-fatal): ${message}`,
		);
	}
}
