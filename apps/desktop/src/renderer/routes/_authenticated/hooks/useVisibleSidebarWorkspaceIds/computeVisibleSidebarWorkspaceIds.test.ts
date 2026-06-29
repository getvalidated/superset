import { describe, expect, it } from "bun:test";
import { computeVisibleSidebarWorkspaceIds } from "./computeVisibleSidebarWorkspaceIds";

const MACHINE_ID = "machine-local";

describe("computeVisibleSidebarWorkspaceIds", () => {
	it("includes a known workspace that is not hidden", () => {
		const visible = computeVisibleSidebarWorkspaceIds({
			localStateWorkspaces: [{ id: "ws-1", isHidden: false }],
			localMainWorkspaces: [],
			machineId: MACHINE_ID,
		});
		expect(visible).toEqual(new Set(["ws-1"]));
	});

	it("excludes a workspace tombstoned as hidden", () => {
		const visible = computeVisibleSidebarWorkspaceIds({
			localStateWorkspaces: [
				{ id: "ws-1", isHidden: false },
				{ id: "ws-2", isHidden: true },
			],
			localMainWorkspaces: [],
			machineId: MACHINE_ID,
		});
		expect(visible).toEqual(new Set(["ws-1"]));
	});

	it("does not require the workspace's project to be pinned", () => {
		// No project/section inputs exist at all: visibility must not depend on
		// sidebar-project membership (the regression that hid ports when the
		// v2SidebarProjects collection was empty or mid-resync).
		const visible = computeVisibleSidebarWorkspaceIds({
			localStateWorkspaces: [{ id: "ws-unpinned" }],
			localMainWorkspaces: [],
			machineId: MACHINE_ID,
		});
		expect(visible).toEqual(new Set(["ws-unpinned"]));
	});

	it("auto-includes a local main workspace that has no local-state row", () => {
		const visible = computeVisibleSidebarWorkspaceIds({
			localStateWorkspaces: [],
			localMainWorkspaces: [{ id: "main-1", hostId: MACHINE_ID }],
			machineId: MACHINE_ID,
		});
		expect(visible).toEqual(new Set(["main-1"]));
	});

	it("excludes a main workspace on a different machine", () => {
		const visible = computeVisibleSidebarWorkspaceIds({
			localStateWorkspaces: [],
			localMainWorkspaces: [{ id: "main-remote", hostId: "machine-other" }],
			machineId: MACHINE_ID,
		});
		expect(visible).toEqual(new Set());
	});

	it("does not re-add a local main that was dismissed via a hidden row", () => {
		// The hidden row decides its fate in the first pass; the main-workspace
		// pass must not resurrect it.
		const visible = computeVisibleSidebarWorkspaceIds({
			localStateWorkspaces: [{ id: "main-1", isHidden: true }],
			localMainWorkspaces: [{ id: "main-1", hostId: MACHINE_ID }],
			machineId: MACHINE_ID,
		});
		expect(visible).toEqual(new Set());
	});

	it("adds nothing from the main pass when the local machine id is unknown", () => {
		const visible = computeVisibleSidebarWorkspaceIds({
			localStateWorkspaces: [],
			localMainWorkspaces: [{ id: "main-1", hostId: MACHINE_ID }],
			machineId: null,
		});
		expect(visible).toEqual(new Set());
	});
});
