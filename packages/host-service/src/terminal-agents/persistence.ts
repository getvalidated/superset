import { eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { HostDb } from "../db";
import { terminalAgentBindings, terminalSessions } from "../db/schema";
import type {
	TerminalAgentBindingPersistence,
	TerminalAgentStore,
} from "./store";
import type { TerminalAgentBinding } from "./types";

/**
 * Prune bindings whose terminal can no longer be hosting an agent: the
 * session row is missing, `exited`/`disposed`, or workspace-less (the same
 * orphan criteria the terminal reaper uses). Exit-event pruning only covers
 * terminals that die while the host-service is up, so the reaper runs this
 * each pass — immediately at startup (draining bindings persisted for
 * terminals that died in between) and then on the reap cadence.
 */
export function reconcileTerminalAgentBindings({
	db,
	store,
}: {
	db: HostDb;
	store: TerminalAgentStore;
}): void {
	const defunct = db
		.select({ terminalId: terminalAgentBindings.terminalId })
		.from(terminalAgentBindings)
		.leftJoin(
			terminalSessions,
			eq(terminalAgentBindings.terminalId, terminalSessions.id),
		)
		.where(
			or(
				isNull(terminalSessions.id),
				inArray(terminalSessions.status, ["exited", "disposed"]),
				isNull(terminalSessions.originWorkspaceId),
			),
		)
		.all();

	for (const row of defunct) {
		store.markTerminalExited(row.terminalId);
	}
}

export class SqliteTerminalAgentBindingPersistence
	implements TerminalAgentBindingPersistence
{
	constructor(private readonly db: HostDb) {}

	load(): TerminalAgentBinding[] {
		const rows = this.db
			.select({
				terminalId: terminalAgentBindings.terminalId,
				workspaceId: terminalAgentBindings.workspaceId,
				agentId: terminalAgentBindings.agentId,
				agentSessionId: terminalAgentBindings.agentSessionId,
				definitionId: terminalAgentBindings.definitionId,
				startedAt: terminalAgentBindings.startedAt,
				lastEventAt: terminalAgentBindings.lastEventAt,
				lastEventType: terminalAgentBindings.lastEventType,
			})
			.from(terminalAgentBindings)
			.innerJoin(
				terminalSessions,
				eq(terminalAgentBindings.terminalId, terminalSessions.id),
			)
			.where(ne(terminalSessions.status, "disposed"))
			.all();

		return rows.map((row) => ({
			terminalId: row.terminalId,
			workspaceId: row.workspaceId,
			agentId: row.agentId,
			...(row.agentSessionId ? { agentSessionId: row.agentSessionId } : {}),
			...(row.definitionId ? { definitionId: row.definitionId } : {}),
			startedAt: row.startedAt,
			lastEventAt: row.lastEventAt,
			lastEventType: row.lastEventType,
		}));
	}

	upsert(binding: TerminalAgentBinding): void {
		this.db
			.insert(terminalAgentBindings)
			.values({
				terminalId: binding.terminalId,
				workspaceId: binding.workspaceId,
				agentId: binding.agentId,
				agentSessionId: binding.agentSessionId ?? null,
				definitionId: binding.definitionId ?? null,
				startedAt: binding.startedAt,
				lastEventAt: binding.lastEventAt,
				lastEventType: binding.lastEventType,
			})
			.onConflictDoUpdate({
				target: terminalAgentBindings.terminalId,
				set: {
					workspaceId: binding.workspaceId,
					agentId: binding.agentId,
					agentSessionId: binding.agentSessionId ?? null,
					definitionId: binding.definitionId ?? null,
					startedAt: binding.startedAt,
					lastEventAt: binding.lastEventAt,
					lastEventType: binding.lastEventType,
				},
			})
			.run();
	}

	delete(terminalId: string): void {
		this.db
			.delete(terminalAgentBindings)
			.where(eq(terminalAgentBindings.terminalId, terminalId))
			.run();
	}
}
