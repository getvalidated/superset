import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type HostDb = ReturnType<typeof createDb>;

/**
 * How long a write statement waits for a lock before giving up. Migrations run
 * before the port binds, so contention here (a prior host-service draining, a
 * WAL checkpoint, a racing process) used to surface as an immediate SQLITE_BUSY.
 * We wait instead. Kept comfortably below the coordinator's health-check window
 * (`HEALTH_POLL_TIMEOUT_MS`) so a recoverable stall finishes before the
 * supervisor declares the process dead.
 */
const MIGRATION_BUSY_TIMEOUT_MS = 8_000;

export function createDb(dbPath: string, migrationsFolder: string) {
	mkdirSync(dirname(dbPath), { recursive: true });

	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	sqlite.pragma(`busy_timeout = ${MIGRATION_BUSY_TIMEOUT_MS}`);

	const db = drizzle(sqlite, { schema });

	console.error(
		`[host-service:db] Initialized at ${dbPath}, migrations from ${migrationsFolder}`,
	);

	// Fail closed. drizzle runs all pending migrations in a single
	// BEGIN/COMMIT and ROLLBACKs on any error, so a failure leaves the DB at
	// its prior version (never half-applied). Throwing here propagates to
	// `serve.ts` `main().catch(... process.exit(1))` so the coordinator's
	// health check fails and it can recover (kill the stale process, respawn)
	// instead of silently serving a DB that's missing tables.
	try {
		migrate(db, { migrationsFolder });
	} catch (error) {
		console.error("[host-service:db] Migration failed:", error);
		sqlite.close();
		throw new Error(
			`[host-service:db] Migration failed for ${dbPath}; refusing to start on an unmigrated database`,
			{ cause: error },
		);
	}

	return db;
}
