import { describe, expect, it } from "bun:test";
import {
	type Collection,
	createCollection,
	localStorageCollectionOptions,
} from "@tanstack/react-db";
import {
	type WorkspaceLocalStateRow,
	workspaceLocalStateSchema,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import {
	type LocalWorkspaceForPlacement,
	selectWorktreesToPlace,
} from "./selectWorktreesToPlace";

/**
 * Reproduces the renderer-pegging infinite loop from issue #5496.
 *
 * When `v2-workspace-local-state-<orgId>` exceeds Chromium's localStorage
 * quota, `@tanstack/db`'s `localStorageCollectionOptions` rethrows
 * `QuotaExceededError` on every write, so the optimistic insert rolls back and
 * no row ever lands. `usePlaceLocalWorktreesInSidebar` reacts to the (unchanged)
 * live query and re-selects the same worktree, insert-fail-rollback-repeat,
 * forever. The fix: the reconciler records each attempt and backs off, so a
 * deterministically-failing placement runs once instead of spinning.
 */

const noopEvents = {
	addEventListener: () => {},
	removeEventListener: () => {},
};

function quotaExceededError(): Error {
	const error = new Error(
		"Failed to set the 'x' property on 'Storage': Setting the value exceeded the quota.",
	);
	error.name = "QuotaExceededError";
	return error;
}

/**
 * localStorage stand-in that throws `QuotaExceededError` once total bytes for a
 * key would exceed `maxBytes` — mirroring Chromium's ~10 MB per-origin cap.
 */
function makeQuotaLimitedStorage(maxBytes: number) {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (key.length + value.length > maxBytes) {
				throw quotaExceededError();
			}
			map.set(key, value);
		},
		removeItem: (key: string) => {
			map.delete(key);
		},
	};
}

function makeLocalStateCollection(
	maxBytes: number,
): Collection<WorkspaceLocalStateRow> {
	return createCollection(
		localStorageCollectionOptions({
			id: `test-wls-${maxBytes}-${Math.abs(maxBytes)}`,
			storageKey: "v2-workspace-local-state-org",
			schema: workspaceLocalStateSchema,
			getKey: (item: WorkspaceLocalStateRow) => item.workspaceId,
			storage: makeQuotaLimitedStorage(maxBytes),
			storageEventApi: noopEvents,
		}),
	) as unknown as Collection<WorkspaceLocalStateRow>;
}

/**
 * Mirrors the body of `usePlaceLocalWorktreesInSidebar`'s effect: read the
 * placed rows from the collection, select worktrees to place, then attempt the
 * insert. Returns how many worktrees this pass tried to place. Passing
 * `attempted` models the fix's per-session backoff ref.
 */
async function reconcileOnce(
	collection: Collection<WorkspaceLocalStateRow>,
	localWorkspaces: LocalWorkspaceForPlacement[],
	attempted?: Set<string>,
): Promise<number> {
	const placedWorkspaceIds = new Set(
		[...collection.state.values()].map((row) => row.workspaceId),
	);
	const toPlace = selectWorktreesToPlace(
		localWorkspaces,
		placedWorkspaceIds,
		attempted,
	);
	for (const worktree of toPlace) {
		attempted?.add(worktree.id);
		const tx = collection.insert({
			workspaceId: worktree.id,
			createdAt: new Date(),
			sidebarState: {
				projectId: worktree.projectId,
				tabOrder: 1,
				sectionId: null,
				changesFilter: { kind: "all" },
				changesViewMode: "folders",
				activeTab: "changes",
				isHidden: false,
			},
			paneLayout: { version: 1, tabs: [], activeTabId: null },
			viewedFiles: [],
			recentlyViewedFiles: [],
			workspaceRunTerminals: {},
		});
		// The write rejects under quota pressure; swallow so the loop harness can
		// keep driving, exactly as the rolled-back optimistic mutation would.
		await tx.isPersisted.promise.catch(() => {});
	}
	return toPlace.length;
}

const WORKTREE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

describe("worktree placement under localStorage quota pressure (issue #5496)", () => {
	const localWorkspaces: LocalWorkspaceForPlacement[] = [
		{ id: WORKTREE_ID, projectId: PROJECT_ID, type: "worktree" },
	];

	it("keeps re-selecting the same worktree every cycle without the backoff (the bug)", async () => {
		const collection = makeLocalStateCollection(0);
		await collection.preload();

		let selections = 0;
		for (let cycle = 0; cycle < 5; cycle++) {
			selections += await reconcileOnce(collection, localWorkspaces);
		}

		// No backoff: the rolled-back insert never persists, so every cycle
		// re-selects wt-1 — this unbounded retry is what pegs the renderer.
		expect(selections).toBe(5);
		expect(collection.state.size).toBe(0);
	});

	it("attempts placement only once with the backoff, even though the write keeps failing (the fix)", async () => {
		const collection = makeLocalStateCollection(0);
		await collection.preload();

		const attempted = new Set<string>();
		let selections = 0;
		for (let cycle = 0; cycle < 5; cycle++) {
			selections += await reconcileOnce(collection, localWorkspaces, attempted);
		}

		// With the backoff the reconciler gives up after one failed attempt
		// instead of spinning forever.
		expect(selections).toBe(1);
		expect(collection.state.size).toBe(0);
	});

	it("still places a worktree exactly once when the write succeeds", async () => {
		const collection = makeLocalStateCollection(10_000);
		await collection.preload();

		const attempted = new Set<string>();
		let selections = 0;
		for (let cycle = 0; cycle < 3; cycle++) {
			selections += await reconcileOnce(collection, localWorkspaces, attempted);
		}

		// Placed on the first cycle; the persisted row suppresses re-selection
		// on later cycles.
		expect(selections).toBe(1);
		expect(collection.state.size).toBe(1);
		expect(collection.get(WORKTREE_ID)).toBeDefined();
	});
});
