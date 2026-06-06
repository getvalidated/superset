import type { HostDb } from "../../db/index.ts";
import { terminalSessions } from "../../db/schema.ts";
import { getDaemonClient } from "../daemon-client-singleton.ts";
import { disposeSessionAndWait } from "../terminal.ts";

export interface ReapResult {
	reaped: number;
	failed: number;
}

const REAP_INTERVAL_MS = 5 * 60 * 1000;

const rowlessSessionsPendingSecondPass = new Set<string>();

export function startTerminalReaper(db: HostDb): () => void {
	const run = () => {
		void reapOrphanedSessions(db)
			.then((result) => {
				if (result.reaped > 0 || result.failed > 0) {
					console.log(
						`[host-service] terminal reaper: ${result.reaped} reaped, ${result.failed} failed`,
					);
				}
			})
			.catch((err) => {
				console.warn("[host-service] terminal reaper failed:", err);
			});
	};
	run();
	const interval = setInterval(run, REAP_INTERVAL_MS);
	interval.unref();
	return () => clearInterval(interval);
}

export async function reapOrphanedSessions(db: HostDb): Promise<ReapResult> {
	const daemon = await getDaemonClient();
	const liveSessions = (await daemon.list()).filter((session) => session.alive);
	const liveIds = new Set(liveSessions.map((session) => session.id));

	for (const id of rowlessSessionsPendingSecondPass) {
		if (!liveIds.has(id)) rowlessSessionsPendingSecondPass.delete(id);
	}

	if (liveSessions.length === 0) return { reaped: 0, failed: 0 };

	const rows = db
		.select({
			id: terminalSessions.id,
			status: terminalSessions.status,
			originWorkspaceId: terminalSessions.originWorkspaceId,
		})
		.from(terminalSessions)
		.all();
	const rowById = new Map(rows.map((row) => [row.id, row]));

	const orphanIds: string[] = [];
	const stillRowless = new Set<string>();
	for (const session of liveSessions) {
		const row = rowById.get(session.id);
		if (!row) {
			if (rowlessSessionsPendingSecondPass.has(session.id)) {
				orphanIds.push(session.id);
			} else {
				stillRowless.add(session.id);
			}
			continue;
		}
		if (
			row.status === "disposed" ||
			row.status === "exited" ||
			!row.originWorkspaceId
		) {
			orphanIds.push(session.id);
		}
	}

	rowlessSessionsPendingSecondPass.clear();
	for (const id of stillRowless) rowlessSessionsPendingSecondPass.add(id);

	let reaped = 0;
	let failed = 0;
	for (const id of orphanIds) {
		try {
			const result = await disposeSessionAndWait(id, db);
			if (result.daemonCloseSucceeded) reaped += 1;
			else failed += 1;
		} catch {
			failed += 1;
		}
	}
	return { reaped, failed };
}
