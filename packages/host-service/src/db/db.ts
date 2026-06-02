import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type HostDb = ReturnType<typeof createDb>;

/**
 * How long a write statement waits for a lock before giving up. Applies for the
 * connection's whole lifetime, not only migrations: migrations run before the
 * port binds, so contention there (a prior host-service draining, a WAL
 * checkpoint, a racing process) used to surface as an immediate SQLITE_BUSY — we
 * wait instead. Kept comfortably below the coordinator's health-check window
 * (`HEALTH_POLL_TIMEOUT_MS`) so a recoverable stall finishes before the
 * supervisor declares the process dead.
 */
export const MIGRATION_BUSY_TIMEOUT_MS = 8_000;

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

	// No catch — fail closed. drizzle runs all pending migrations in a single
	// BEGIN/COMMIT and ROLLBACKs on any error, so a failure leaves the DB at its
	// prior version (never half-applied). Letting it throw propagates to
	// `serve.ts` `main().catch(... process.exit(1))`, so the coordinator's health
	// check fails and it recovers (kill the stale process, respawn) instead of
	// silently serving a DB that's missing tables.
	migrate(db, { migrationsFolder });

	return db;
}
