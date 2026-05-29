// Integration test for the 1.12.0 host-service migration crash and its fix.
//
// Real `createDb` + real drizzle migration files (incl. 0005) + a real second
// process holding the write lock. Runs under Node (`node --test`) but MUST be
// invoked with the Electron-ABI node — better-sqlite3 here is built for the
// host-service runtime (Electron), which is also the only runtime that can
// load it. Same-process lock holding would deadlock (better-sqlite3 is
// synchronous and single-threaded), so we spawn a sibling process for genuine
// cross-process contention.
//
//   ELECTRON_RUN_AS_NODE=1 <electron> --experimental-strip-types --test \
//     src/db/db.contention.node-test.ts
//
// Pre-fix behavior (reproduced): contention → migrate stalls on the busy
// timeout → SQLITE_BUSY → db.ts swallowed it → service came up on a
// half-migrated DB (runtime "no such table host_settings").
//
// Post-fix behavior (asserted here):
//   - sustained contention past the busy timeout → createDb THROWS (fail
//     closed), and the DB is left cleanly unmigrated (atomic rollback), never
//     half-applied;
//   - contention that clears within the busy timeout → createDb WAITS then
//     succeeds (host_settings present).

import { strict as assert } from "node:assert";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createDb } from "./db.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/host-service/src/db → packages/host-service/drizzle
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");

// Mirror of MIGRATION_BUSY_TIMEOUT_MS in db.ts. Kept local so the test pins the
// behavior even if the source constant moves.
const BUSY_TIMEOUT_MS = 8_000;

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hs-db-contention-"));
	dbPath = path.join(tmpDir, "host.db");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Spawn a sibling Node process that holds an IMMEDIATE (write) transaction on
 * the db for `holdMs`, then rolls back and exits (persisting nothing).
 * Resolves once the child confirms the lock is held.
 */
function holdWriteLock(
	targetDbPath: string,
	holdMs: number,
): Promise<childProcess.ChildProcess> {
	const script = `
		const Database = require('better-sqlite3');
		const db = new Database(${JSON.stringify(targetDbPath)}, { timeout: 0 });
		db.pragma('journal_mode = WAL');
		db.exec('BEGIN IMMEDIATE');          // acquire the write lock now
		process.stdout.write('LOCKED\\n');
		setTimeout(() => { try { db.exec('ROLLBACK'); } catch {} process.exit(0); }, ${holdMs});
	`;
	const child = childProcess.spawn(process.execPath, ["-e", script], {
		cwd: path.resolve(__dirname, "../.."),
		stdio: ["ignore", "pipe", "inherit"],
	});
	return new Promise((resolve, reject) => {
		let out = "";
		const timer = setTimeout(
			() => reject(new Error("lock holder never confirmed LOCKED")),
			10_000,
		);
		child.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString();
			if (out.includes("LOCKED")) {
				clearTimeout(timer);
				resolve(child);
			}
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`lock holder exited early (code=${code})`));
		});
	});
}

function tableExists(targetDbPath: string, tableName: string): boolean {
	const probe = new Database(targetDbPath, { readonly: true });
	try {
		const row = probe
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
			.get(tableName);
		return !!row;
	} finally {
		probe.close();
	}
}

describe("host-service DB migration under write-lock contention", () => {
	test("baseline: no contention → 0005 applies, host_settings exists", () => {
		createDb(dbPath, MIGRATIONS_FOLDER);
		assert.equal(
			tableExists(dbPath, "host_settings"),
			true,
			"host_settings should exist after a clean migration",
		);
	});

	test("fail-closed: sustained contention past the busy timeout → createDb THROWS, DB left cleanly unmigrated", async () => {
		// Hold the lock for 20s — longer than the 8s busy timeout, so migrate
		// can't acquire it.
		const holder = await holdWriteLock(dbPath, 20_000);

		const start = Date.now();
		let threw = false;
		try {
			createDb(dbPath, MIGRATIONS_FOLDER);
		} catch {
			threw = true;
		}
		const elapsedMs = Date.now() - start;
		holder.kill("SIGKILL");

		// 1. Fail closed — no silently-served half-migrated DB.
		assert.equal(
			threw,
			true,
			"createDb must throw on sustained contention, not swallow and return",
		);

		// 2. It waited on the busy timeout (didn't fail instantly), bounded so it
		//    stays inside the coordinator's health window.
		assert.ok(
			elapsedMs >= BUSY_TIMEOUT_MS - 1_500,
			`expected to wait ~busy_timeout before failing, waited ${elapsedMs}ms`,
		);
		assert.ok(
			elapsedMs <= BUSY_TIMEOUT_MS + 6_000,
			`expected a bounded wait, waited ${elapsedMs}ms`,
		);

		// 3. The DB is cleanly unmigrated (atomic rollback), never half-applied.
		assert.equal(
			tableExists(dbPath, "host_settings"),
			false,
			"failed migration must leave host_settings absent (clean rollback)",
		);
	});

	test("recovery: contention that clears within the busy timeout → createDb waits then succeeds", async () => {
		// Hold for 2.5s, well under the 8s budget; migrate should wait it out.
		await holdWriteLock(dbPath, 2_500);

		const start = Date.now();
		createDb(dbPath, MIGRATIONS_FOLDER);
		const elapsedMs = Date.now() - start;

		assert.ok(
			elapsedMs >= 1_500,
			`expected createDb to wait for the lock (~2.5s), took ${elapsedMs}ms`,
		);
		assert.equal(
			tableExists(dbPath, "host_settings"),
			true,
			"host_settings should exist once the lock clears within the timeout",
		);
	});
});
