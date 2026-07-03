import type { HostDb } from "../db";
import { startTerminalReaper } from "../terminal/reaper";

/**
 * Process-lifetime background services for a serving host-service process.
 * `createApp` builds the request-serving surface; work that must tick for the
 * life of the process regardless of traffic starts here instead. Every
 * serving entry point (serve.ts and the desktop child) calls this exactly
 * once after binding — an entry that skips it ships without orphan reaping or
 * port scanning for unattached daemon sessions, which is how the desktop app
 * shipped without either (PR #5438).
 *
 * Returns a stop function that tears down everything started here.
 */
export function startHostRuntime(db: HostDb): () => void {
	return startTerminalReaper(db);
}
