#!/usr/bin/env bun
/**
 * Quick PR-flow tests against the local host service. Uses the manifest's
 * PSK so we don't need a fresh JWT.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ORG = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROJECT = "1c99c8eb-1b31-4f04-9ac4-61a2760c74b6"; // superset repo
const SUPERSET_HOME =
	process.env.SUPERSET_HOME_DIR ??
	`${process.env.HOME}/.superset/worktrees/1c99c8eb-1b31-4f04-9ac4-61a2760c74b6/pr1-host-agent-configs/superset-dev-data`;

interface Manifest {
	pid: number;
	endpoint: string;
	authToken: string;
}

const manifest: Manifest = JSON.parse(
	readFileSync(join(SUPERSET_HOME, "host", ORG, "manifest.json"), "utf-8"),
);

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";
import type { AppRouter } from "/Users/satyapatel/.superset/worktrees/1c99c8eb-1b31-4f04-9ac4-61a2760c74b6/pr1-host-agent-configs/packages/host-service/src/trpc";

const client = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: `${manifest.endpoint}/trpc`,
			transformer: SuperJSON,
			headers: { Authorization: `Bearer ${manifest.authToken}` },
		}),
	],
});

interface CreateOpts {
	pr?: number;
	branch?: string;
	name?: string;
	prompt?: string;
}

async function timed<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T | null> {
	const t0 = performance.now();
	try {
		const result = await fn();
		const ms = performance.now() - t0;
		console.log(`  ${label}: ${ms.toFixed(0)}ms ✓`);
		return result;
	} catch (err) {
		const ms = performance.now() - t0;
		const msg = err instanceof Error ? err.message : String(err);
		const short = msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
		console.log(`  ${label}: ${ms.toFixed(0)}ms ✗ ${short}`);
		return null;
	}
}

async function tryCreate(opts: CreateOpts) {
	const input: Record<string, unknown> = { projectId: PROJECT };
	if (opts.pr) input.pr = opts.pr;
	if (opts.branch) input.branch = opts.branch;
	if (opts.name) input.name = opts.name;
	if (opts.prompt) input.agents = [{ agent: "claude", prompt: opts.prompt }];
	return client.workspaces.create.mutate(input as never);
}

async function tryDelete(id: string) {
	return client.workspace.delete.mutate({ id });
}

const cleanup: string[] = [];

async function main() {
	console.log(`Daemon @ ${manifest.endpoint}`);

	console.log("\n── B1: open PR (4024), no pre-existing ──");
	const b1 = await timed("create", () => tryCreate({ pr: 4024 }));
	if (b1) {
		console.log(
			`    name="${b1.workspace.name}" branch=${b1.workspace.branch} alreadyExists=${b1.alreadyExists}`,
		);
		cleanup.push(b1.workspace.id);
	}

	console.log("\n── B4: same PR (4024) again, expect alreadyExists=true ──");
	const b4 = await timed("create", () => tryCreate({ pr: 4024 }));
	if (b4) {
		console.log(
			`    name="${b4.workspace.name}" branch=${b4.workspace.branch} alreadyExists=${b4.alreadyExists}`,
		);
	}

	console.log("\n── B8: merged PR (4017), expect success no warning ──");
	const b8 = await timed("create", () => tryCreate({ pr: 4017 }));
	if (b8) {
		console.log(
			`    name="${b8.workspace.name}" branch=${b8.workspace.branch} alreadyExists=${b8.alreadyExists}`,
		);
		cleanup.push(b8.workspace.id);
	}

	console.log("\n── PR + typed name (4012), expect name = typed ──");
	const named = await timed("create", () =>
		tryCreate({ pr: 4012, name: "Test Custom Name" }),
	);
	if (named) {
		console.log(
			`    name="${named.workspace.name}" branch=${named.workspace.branch}`,
		);
		cleanup.push(named.workspace.id);
	}

	console.log("\n── A1 validation: branch + pr both set ──");
	await timed("create", () => tryCreate({ pr: 4007, branch: "should-fail" }));

	console.log("\n── C1.6: tag rejection (cli-v0.2.3 is a real tag) ──");
	await timed("create", () => tryCreate({ branch: "cli-v0.2.3" }));

	console.log("\n── C2.5: auto-gen branch + prompt (full AI) ──");
	const ai = await timed("create", () =>
		tryCreate({
			prompt: "Investigate spurious test failures in the auth module",
		}),
	);
	if (ai) {
		console.log(
			`    name="${ai.workspace.name}" branch=${ai.workspace.branch}`,
		);
		cleanup.push(ai.workspace.id);
	}

	console.log("\n── C2 fallback: auto-gen, no prompt (friendly random) ──");
	const friendly = await timed("create", () => tryCreate({}));
	if (friendly) {
		console.log(
			`    name="${friendly.workspace.name}" branch=${friendly.workspace.branch}`,
		);
		cleanup.push(friendly.workspace.id);
	}

	console.log("\n── cleanup ──");
	for (const id of cleanup) {
		await timed(`delete ${id.slice(0, 8)}`, () => tryDelete(id));
	}
}

main().catch((err) => {
	console.error("test failed:", err);
	process.exit(1);
});
