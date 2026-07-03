import { describe, expect, it } from "bun:test";
import type { SelectV2Workspace } from "@superset/db/schema";
import { mergeWorkspacePresence } from "./mergeWorkspacePresence";

const ORG = "org-1";
const LOCAL_MACHINE = "machine-local";

function ws(overrides: Partial<SelectV2Workspace>): SelectV2Workspace {
	return {
		id: "ws-1",
		organizationId: ORG,
		projectId: "project-1",
		hostId: LOCAL_MACHINE,
		name: "alpha",
		branch: "feat/alpha",
		type: "worktree",
		createdByUserId: null,
		taskId: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	} as SelectV2Workspace;
}

describe("mergeWorkspacePresence", () => {
	it("keeps local rows and adds other hosts' cloud rows, org-scoped", () => {
		const { rows, patches } = mergeWorkspacePresence({
			local: [ws({ id: "l1" }), ws({ id: "other-org", organizationId: "x" })],
			cloud: [
				ws({ id: "l1" }), // dupe of local — not added twice
				ws({ id: "r1", hostId: "machine-remote" }),
				ws({ id: "r2", hostId: "machine-remote", organizationId: "x" }),
			],
			organizationId: ORG,
			localMachineId: LOCAL_MACHINE,
		});
		expect(rows.map((r) => r.id).sort()).toEqual(["l1", "r1"]);
		expect(patches).toEqual([]);
	});

	it("drops stale cloud presence for this machine (no local row)", () => {
		const { rows } = mergeWorkspacePresence({
			local: [],
			cloud: [ws({ id: "ghost", hostId: LOCAL_MACHINE })],
			organizationId: ORG,
			localMachineId: LOCAL_MACHINE,
		});
		expect(rows).toEqual([]);
	});

	it("adopts newer cloud identity edits and emits a patch", () => {
		const { rows, patches } = mergeWorkspacePresence({
			local: [ws({ updatedAt: new Date("2026-01-01T00:00:00Z") })],
			cloud: [
				ws({
					name: "renamed-remotely",
					taskId: "task-9",
					updatedAt: new Date("2026-01-02T00:00:00Z"),
				}),
			],
			organizationId: ORG,
			localMachineId: LOCAL_MACHINE,
		});
		expect(rows[0]?.name).toBe("renamed-remotely");
		expect(rows[0]?.taskId).toBe("task-9");
		expect(patches).toEqual([
			{ id: "ws-1", name: "renamed-remotely", taskId: "task-9" },
		]);
	});

	it("keeps local identity when the local edit is newer", () => {
		const { rows, patches } = mergeWorkspacePresence({
			local: [
				ws({ name: "local-wins", updatedAt: new Date("2026-01-03T00:00:00Z") }),
			],
			cloud: [
				ws({
					name: "stale-cloud",
					updatedAt: new Date("2026-01-02T00:00:00Z"),
				}),
			],
			organizationId: ORG,
			localMachineId: LOCAL_MACHINE,
		});
		expect(rows[0]?.name).toBe("local-wins");
		expect(patches).toEqual([]);
	});

	it("does not patch when values already match, even if cloud is newer", () => {
		const { patches } = mergeWorkspacePresence({
			local: [ws({})],
			cloud: [ws({ updatedAt: new Date("2026-01-05T00:00:00Z") })],
			organizationId: ORG,
			localMachineId: LOCAL_MACHINE,
		});
		expect(patches).toEqual([]);
	});

	it("patches only the differing field and never branch", () => {
		const { rows, patches } = mergeWorkspacePresence({
			local: [ws({ branch: "feat/local-branch" })],
			cloud: [
				ws({
					taskId: "task-1",
					branch: "feat/other",
					updatedAt: new Date("2026-01-02T00:00:00Z"),
				}),
			],
			organizationId: ORG,
			localMachineId: LOCAL_MACHINE,
		});
		expect(patches).toEqual([{ id: "ws-1", taskId: "task-1" }]);
		expect(rows[0]?.branch).toBe("feat/local-branch");
	});
});
