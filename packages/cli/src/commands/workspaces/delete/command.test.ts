import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Regression tests for #5497.
 *
 * `superset workspaces delete <ids...>` aborted the entire remaining argument
 * list the moment one ID failed to resolve (e.g. it had already been deleted
 * on another device). Batch cleanups silently left "ghost" workspaces behind.
 *
 * The fix: keep going after a per-ID failure, treat a not-found ID as an
 * idempotent no-op, and report a per-ID outcome (exiting non-zero only when a
 * real delete fails).
 */

// Track which IDs actually reached the host-service delete mutation.
const deleteCalls: string[] = [];
let deleteImpl: (id: string) => Promise<{ warnings?: string[] }> =
	async () => ({});

mock.module("../../../lib/host-target", () => ({
	resolveHostFilter: () => undefined,
	resolveHostTarget: () => ({
		kind: "remote" as const,
		hostId: "host-1",
		client: {
			workspace: {
				delete: {
					mutate: async ({ id }: { id: string }) => {
						deleteCalls.push(id);
						return deleteImpl(id);
					},
				},
			},
		},
	}),
}));

const { default: deleteCommand } = await import("./command");

function makeCtx(existing: Set<string>) {
	return {
		config: { organizationId: "org-1" },
		bearer: "jwt",
		authSource: "config" as const,
		api: {
			v2Workspace: {
				getFromHost: {
					query: async ({ id }: { id: string }) =>
						existing.has(id) ? { hostId: "host-1" } : null,
				},
			},
		},
	};
}

function runDelete(ctx: ReturnType<typeof makeCtx>, ids: string[]) {
	return deleteCommand.run({
		ctx: ctx as never,
		args: { ids } as never,
		options: {} as never,
		signal: new AbortController().signal,
	});
}

describe("workspaces delete (#5497)", () => {
	beforeEach(() => {
		deleteCalls.length = 0;
		deleteImpl = async () => ({});
	});

	test("continues deleting remaining IDs when the first is already gone", async () => {
		const stale = "934a03ef-0108-432b-b898-e51e154e4f05";
		const valid = Array.from({ length: 9 }, (_, i) => `valid-${i}`);
		const ctx = makeCtx(new Set(valid));

		const result = (await runDelete(ctx, [stale, ...valid])) as {
			data: { deleted: string[]; notFound: string[] };
		};

		// All nine valid workspaces must still be deleted despite the stale first ID.
		expect(deleteCalls.sort()).toEqual([...valid].sort());
		expect(result.data.deleted.sort()).toEqual([...valid].sort());
		// The stale ID is reported as not-found rather than poisoning the batch.
		expect(result.data.notFound).toEqual([stale]);
	});

	test("exits non-zero and reports the offender when a real delete fails", async () => {
		const ids = ["a", "b", "c"];
		const ctx = makeCtx(new Set(ids));
		deleteImpl = async (id) => {
			if (id === "b") throw new Error("host exploded");
			return {};
		};

		let threw: unknown;
		try {
			await runDelete(ctx, ids);
		} catch (error) {
			threw = error;
		}

		// A genuine failure surfaces as a non-zero exit (thrown error)...
		expect(threw).toBeInstanceOf(Error);
		expect(String((threw as Error).message)).toContain("b");
		// ...but the other IDs were still attempted.
		expect(deleteCalls.sort()).toEqual(["a", "b", "c"]);
	});
});
