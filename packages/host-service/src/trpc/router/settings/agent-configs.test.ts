import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../../../db/schema";
import type { HostDb } from "../../../db";
import type { HostServiceContext } from "../../../types";
import { agentConfigsRouter } from "./agent-configs";

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("../../../../drizzle", import.meta.url),
);

function freshCaller() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	const ctx = {
		db: db as unknown as HostDb,
		isAuthenticated: true,
	} as unknown as HostServiceContext;
	return agentConfigsRouter.createCaller(ctx);
}

let caller: ReturnType<typeof freshCaller>;

beforeEach(() => {
	caller = freshCaller();
});

test("migration seeds the 5 default agents in order with userModified=false", async () => {
	const result = await caller.list();
	expect(result.map((r) => r.id)).toEqual([
		"seed-claude",
		"seed-amp",
		"seed-codex",
		"seed-gemini",
		"seed-copilot",
	]);
	expect(result.map((r) => r.order)).toEqual([0, 1, 2, 3, 4]);
	expect(result.every((r) => r.userModified === false)).toBe(true);
});

test("add appends at next order and marks userModified", async () => {
	const id = crypto.randomUUID();
	const added = await caller.add({
		id,
		presetId: "claude",
		label: "Custom Claude",
		launchCommand: "claude --foo",
		promptInput: "argv",
	});
	expect(added).toMatchObject({ id, order: 5, userModified: true });
});

test("update flips userModified so future migrations can skip customized rows", async () => {
	await caller.update({
		id: "seed-claude",
		patch: { launchCommand: "claude --override" },
	});
	const list = await caller.list();
	const claude = list.find((r) => r.id === "seed-claude");
	expect(claude?.launchCommand).toBe("claude --override");
	expect(claude?.userModified).toBe(true);
});

test("remove compacts order across remaining rows", async () => {
	await caller.remove({ id: "seed-codex" });
	const list = await caller.list();
	expect(list.map((r) => r.id)).toEqual([
		"seed-claude",
		"seed-amp",
		"seed-gemini",
		"seed-copilot",
	]);
	expect(list.map((r) => r.order)).toEqual([0, 1, 2, 3]);
});

test("reorder rejects when ids set does not match current configs", async () => {
	await expect(
		caller.reorder({ ids: ["seed-claude", "seed-amp"] }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
