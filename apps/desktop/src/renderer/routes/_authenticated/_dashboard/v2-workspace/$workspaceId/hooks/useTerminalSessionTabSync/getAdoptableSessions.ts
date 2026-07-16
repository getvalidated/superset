export interface AdoptableSessionLike {
	terminalId: string;
	exited: boolean;
	createdAt: number;
}

interface TerminalPaneLike {
	kind: string;
	data: unknown;
}

interface WorkspaceTabLike {
	panes: Record<string, TerminalPaneLike>;
}

/** Terminal ids referenced by any terminal pane in the given tabs. */
export function collectAttachedTerminalIds(
	tabs: readonly WorkspaceTabLike[],
	into: Set<string> = new Set(),
): Set<string> {
	for (const tab of tabs) {
		for (const pane of Object.values(tab.panes)) {
			if (pane.kind !== "terminal") continue;
			const terminalId = (pane.data as { terminalId?: unknown } | null)
				?.terminalId;
			if (typeof terminalId === "string" && terminalId.length > 0) {
				into.add(terminalId);
			}
		}
	}
	return into;
}

/**
 * Live sessions that should be adopted as tabs: running, not already attached
 * to a pane, and not deliberately backgrounded. Oldest first so adopted tab
 * order mirrors session creation order.
 */
export function getAdoptableSessions<T extends AdoptableSessionLike>({
	sessions,
	attachedTerminalIds,
	backgroundTerminalIds,
}: {
	sessions: readonly T[];
	attachedTerminalIds: ReadonlySet<string>;
	backgroundTerminalIds: Iterable<string>;
}): T[] {
	const background = new Set(backgroundTerminalIds);
	return sessions
		.filter(
			(session) =>
				!session.exited &&
				!attachedTerminalIds.has(session.terminalId) &&
				!background.has(session.terminalId),
		)
		.sort(
			(a, b) =>
				a.createdAt - b.createdAt || a.terminalId.localeCompare(b.terminalId),
		);
}
