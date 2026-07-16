import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * Local mirror of telemetry that would otherwise go to PostHog: one JSONL
 * line per event, day-stamped files under <userData>/telemetry/. In dev the
 * PostHog key is a placeholder, so this is the only place autocapture,
 * $dead_click, and custom events actually land — greppable / duckdb-able.
 */

const MAX_RETAINED_FILES = 14;

let cachedDir: string | null = null;
let prunedThisRun = false;

export function localEventStoreDir(): string {
	if (!cachedDir) {
		cachedDir = path.join(app.getPath("userData"), "telemetry");
		fs.mkdirSync(cachedDir, { recursive: true });
	}
	return cachedDir;
}

function pruneOldFiles(dir: string): void {
	const files = fs
		.readdirSync(dir)
		.filter((name) => name.startsWith("events-") && name.endsWith(".jsonl"))
		.sort()
		.reverse();
	for (const stale of files.slice(MAX_RETAINED_FILES)) {
		try {
			fs.unlinkSync(path.join(dir, stale));
		} catch {
			// Best-effort.
		}
	}
}

export function appendLocalEvents(
	source: string,
	events: ReadonlyArray<Record<string, unknown>>,
): string {
	const dir = localEventStoreDir();
	if (!prunedThisRun) {
		prunedThisRun = true;
		pruneOldFiles(dir);
	}
	if (events.length === 0) return dir;
	const receivedAt = new Date().toISOString();
	const lines = events
		.map((event) =>
			JSON.stringify({ __source: source, __received_at: receivedAt, ...event }),
		)
		.join("\n");
	const day = receivedAt.slice(0, 10);
	fs.appendFileSync(path.join(dir, `events-${day}.jsonl`), `${lines}\n`);
	return dir;
}
