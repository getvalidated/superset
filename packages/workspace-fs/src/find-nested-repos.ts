import { readdir } from "node:fs/promises";
import path from "node:path";

// Defensive caps: the whole point of this scan is to keep the watcher from
// ballooning, so the scan itself must never balloon. It prunes at every nested
// repo boundary and at every ignored directory, so a normal tree is scanned in
// full and a pathological one (a project holding thousands of agent worktrees)
// is bounded by the count of worktree roots, not their contents.
const DEFAULT_MAX_DIRS = 50_000;
const DEFAULT_MAX_ROOTS = 5_000;

export interface FindNestedRepoRootsOptions {
	/** Directory basenames to skip while traversing (node_modules, .git, …). */
	pruneDirNames: ReadonlySet<string>;
	/** Stop after scanning this many directories. */
	maxDirs?: number;
	/** Stop after discovering this many nested roots. */
	maxRoots?: number;
}

export interface FindNestedRepoRootsResult {
	/** Absolute paths of nested git repo / worktree roots below `rootPath`. */
	roots: string[];
	/** A scan cap was hit; `roots` may be incomplete. */
	truncated: boolean;
}

/**
 * Walk `rootPath` and return every nested git repo / worktree root beneath it.
 * A directory is a nested root when it contains a `.git` entry (a directory for
 * a normal clone, a file for a `git worktree`); the watch root itself is exempt.
 * The scan prunes at each nested root (never descends into it) and at each
 * `pruneDirNames` entry, so it stays cheap even under a tree that has grown to
 * millions of directories via piled-up worktrees.
 *
 * Symlinked directories are skipped (`Dirent.isDirectory()` is false for them),
 * which also avoids cycles and escaping the tree.
 */
export async function findNestedRepoRoots(
	rootPath: string,
	options: FindNestedRepoRootsOptions,
): Promise<FindNestedRepoRootsResult> {
	const maxDirs = options.maxDirs ?? DEFAULT_MAX_DIRS;
	const maxRoots = options.maxRoots ?? DEFAULT_MAX_ROOTS;
	const roots: string[] = [];
	const stack: string[] = [rootPath];
	let scanned = 0;

	while (stack.length > 0) {
		if (roots.length >= maxRoots || scanned >= maxDirs) {
			return { roots, truncated: true };
		}
		const dir = stack.pop() as string;
		scanned += 1;

		// Vanished or unreadable mid-scan — nothing to prune here.
		const entries = await readdir(dir, { withFileTypes: true }).catch(
			() => null,
		);
		if (!entries) {
			continue;
		}

		if (dir !== rootPath && entries.some((entry) => entry.name === ".git")) {
			roots.push(dir);
			continue; // prune: do not descend into the nested repo
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			if (options.pruneDirNames.has(entry.name)) {
				continue;
			}
			stack.push(path.join(dir, entry.name));
		}
	}

	return { roots, truncated: false };
}
