import type { AppCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";

type BackgroundTerminalCollections = Pick<
	AppCollections,
	"v2WorkspaceLocalState"
>;

/**
 * Durably mark a live session as backgrounded so the session→tab sync does
 * not re-adopt it as a tab. Complements the in-memory markers in
 * terminal-background-intents, which don't survive an app restart.
 */
export function persistBackgroundTerminal(
	collections: BackgroundTerminalCollections,
	workspaceId: string,
	terminalId: string,
): void {
	if (!collections.v2WorkspaceLocalState.get(workspaceId)) return;
	collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
		const ids = draft.backgroundTerminalIds ?? [];
		if (ids.includes(terminalId)) return;
		draft.backgroundTerminalIds = [...ids, terminalId];
	});
}

/** Remove ids from the persisted background set (re-attached or dead). */
export function releaseBackgroundTerminals(
	collections: BackgroundTerminalCollections,
	workspaceId: string,
	terminalIds: readonly string[],
): void {
	if (terminalIds.length === 0) return;
	const row = collections.v2WorkspaceLocalState.get(workspaceId);
	if (!row) return;
	const releasing = new Set(terminalIds);
	if (!(row.backgroundTerminalIds ?? []).some((id) => releasing.has(id))) {
		return;
	}
	collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
		draft.backgroundTerminalIds = (draft.backgroundTerminalIds ?? []).filter(
			(id) => !releasing.has(id),
		);
	});
}
