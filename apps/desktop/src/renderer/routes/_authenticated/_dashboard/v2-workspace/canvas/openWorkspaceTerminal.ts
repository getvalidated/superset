import { toast } from "@superset/ui/sonner";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import type { StoreApi } from "zustand/vanilla";
import type { CanvasStore } from "./canvasStore";
import { openCanvasWindow } from "./openCanvasWindow";
import { type CanvasTerminalData, terminalWindowId } from "./useCanvasSeeding";

/** Whether the workspace has any terminal window on the canvas. */
export function workspaceHasCanvasTerminal(
	store: StoreApi<CanvasStore>,
	workspaceId: string,
): boolean {
	return Object.values(store.getState().windows).some(
		(window) =>
			window.kind === "terminal" && window.workspaceId === workspaceId,
	);
}

/**
 * Spawn a fresh terminal session in the workspace and open its canvas window
 * centered in the current viewport, focused. The session is created before
 * the window is added so the pane's attach doesn't race the session existing
 * on host-service; the id matches the session seeder's, so the next
 * listAllSessions reconcile adopts the window instead of duplicating it.
 */
export async function openWorkspaceTerminalOnCanvas({
	store,
	workspaceId,
	hostUrl,
	themeType,
}: {
	store: StoreApi<CanvasStore>;
	workspaceId: string;
	hostUrl: string;
	themeType: string;
}): Promise<void> {
	const terminalId = crypto.randomUUID();
	try {
		await getHostServiceClientByUrl(hostUrl).terminal.createSession.mutate({
			terminalId,
			workspaceId,
			themeType,
		});
	} catch (error) {
		toast.error(
			`Failed to open terminal: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		return;
	}
	openCanvasWindow(store, {
		id: terminalWindowId(terminalId),
		kind: "terminal",
		workspaceId,
		data: { terminalId, title: null } satisfies CanvasTerminalData,
	});
}
