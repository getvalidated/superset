import { describe, expect, it, mock } from "bun:test";

// Reproduction for #5554: creating a new workspace fails with
//   ENOENT: no such file or directory, mkdir '<worktree>/.superset/attachments'
// The attachments directory is two levels deep (`.superset/attachments`), but the
// adapter used to call `createDirectory` without `recursive: true`. In a freshly
// created worktree the parent `.superset` folder does not exist yet, so the
// non-recursive mkdir throws ENOENT before any file is ever written.
//
// This test cannot touch `node:fs` (renderer code must stay browser-compatible),
// so the tRPC filesystem mock is an in-memory tree that mirrors `node:fs.mkdir`
// semantics: a non-recursive mkdir whose parent is missing throws ENOENT.

const WORKTREE_PATH = "/tmp/worktree/adhesive-radon";

function parentOf(absolutePath: string): string {
	return absolutePath.slice(0, absolutePath.lastIndexOf("/"));
}

/**
 * In-memory filesystem that reproduces the `node:fs.mkdir` ENOENT behaviour the
 * real workspace-fs host layer relies on. `dirs` is seeded with the worktree root
 * only — the `.superset` parent is intentionally absent, matching a fresh worktree.
 */
function mockTrpcClient() {
	const dirs = new Set<string>([WORKTREE_PATH]);
	const files = new Map<string, Buffer>();

	mock.module("renderer/lib/trpc-client", () => ({
		electronTrpcClient: {
			workspaces: {
				get: {
					query: async () => ({ worktreePath: WORKTREE_PATH }),
				},
			},
			filesystem: {
				createDirectory: {
					mutate: async (input: {
						absolutePath: string;
						recursive?: boolean;
					}) => {
						const { absolutePath, recursive } = input;
						if (recursive) {
							// Create the whole ancestor chain, like `mkdir -p`.
							let slash = absolutePath.indexOf("/", 1);
							while (slash !== -1) {
								dirs.add(absolutePath.slice(0, slash));
								slash = absolutePath.indexOf("/", slash + 1);
							}
							dirs.add(absolutePath);
						} else if (!dirs.has(parentOf(absolutePath))) {
							throw new Error(
								`ENOENT: no such file or directory, mkdir '${absolutePath}'`,
							);
						} else {
							dirs.add(absolutePath);
						}
						return { absolutePath, kind: "directory" };
					},
				},
				writeFile: {
					mutate: async (input: { absolutePath: string; content: unknown }) => {
						if (!dirs.has(parentOf(input.absolutePath))) {
							throw new Error(
								`ENOENT: no such file or directory, open '${input.absolutePath}'`,
							);
						}
						const content = input.content as { kind: string; data: string };
						files.set(input.absolutePath, Buffer.from(content.data, "base64"));
						return { ok: true };
					},
				},
			},
		},
	}));

	return { dirs, files };
}

describe("writeAttachmentFiles (#5554)", () => {
	it("creates the nested .superset/attachments directory in a fresh worktree", async () => {
		const { files } = mockTrpcClient();

		const { writeAttachmentFiles } = await import("./terminal-adapter");

		const writtenPaths = await writeAttachmentFiles("ws-1", [
			{
				data: "data:text/plain;base64,aGVsbG8=", // "hello"
				mediaType: "text/plain",
				filename: "note.txt",
			},
		]);

		expect(writtenPaths).toEqual([".superset/attachments/note.txt"]);

		const written = files.get(
			`${WORKTREE_PATH}/.superset/attachments/note.txt`,
		);
		expect(written?.toString("utf-8")).toEqual("hello");
	});
});
