import { afterEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	defaultWorktreesRoot,
	safeResolveWorktreePath,
} from "./worktree-paths";

const ORIGINAL_WORKSPACE_NAME = process.env.SUPERSET_WORKSPACE_NAME;

afterEach(() => {
	if (ORIGINAL_WORKSPACE_NAME === undefined) {
		delete process.env.SUPERSET_WORKSPACE_NAME;
	} else {
		process.env.SUPERSET_WORKSPACE_NAME = ORIGINAL_WORKSPACE_NAME;
	}
});

describe("defaultWorktreesRoot", () => {
	test("defaults to ~/.superset/worktrees when no workspace name is set", () => {
		delete process.env.SUPERSET_WORKSPACE_NAME;
		expect(defaultWorktreesRoot()).toBe(
			join(homedir(), ".superset", "worktrees"),
		);
	});

	test("treats the production name 'superset' as unset", () => {
		process.env.SUPERSET_WORKSPACE_NAME = "superset";
		expect(defaultWorktreesRoot()).toBe(
			join(homedir(), ".superset", "worktrees"),
		);
	});

	test("isolates dev workspaces under ~/.superset-<workspace>/worktrees", () => {
		process.env.SUPERSET_WORKSPACE_NAME = "michael/billowy-interest";
		expect(defaultWorktreesRoot()).toBe(
			join(homedir(), ".superset-michael-billowy-interest", "worktrees"),
		);
	});

	test("sanitizes and truncates the workspace name like SUPERSET_DIR_NAME", () => {
		process.env.SUPERSET_WORKSPACE_NAME =
			"Team/Some_Very Long Workspace Name That Keeps Going";
		expect(defaultWorktreesRoot()).toBe(
			join(
				homedir(),
				".superset-team-some-very-long-workspace-na",
				"worktrees",
			),
		);
	});

	test("falls back to .superset when the name sanitizes to nothing", () => {
		process.env.SUPERSET_WORKSPACE_NAME = "   ";
		expect(defaultWorktreesRoot()).toBe(
			join(homedir(), ".superset", "worktrees"),
		);
	});
});

describe("safeResolveWorktreePath", () => {
	test("resolves under the workspace-scoped default root", () => {
		process.env.SUPERSET_WORKSPACE_NAME = "michael/billowy-interest";
		expect(safeResolveWorktreePath("project-id", "my-branch")).toBe(
			join(
				homedir(),
				".superset-michael-billowy-interest",
				"worktrees",
				"project-id",
				"my-branch",
			),
		);
	});
});
