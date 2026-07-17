import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import { getAllCanvasStores } from "./canvasStore";
import type { CanvasTerminalData } from "./useCanvasSeeding";

/**
 * Drop every canvas window owned by a closing workspace, across all org
 * canvases. Called from the workspace close/delete paths (alongside
 * disposeHostSessionsForWorkspace) so the canvas reflects the closure
 * immediately instead of waiting for — or, for a workspace in no host's
 * reconcile scope, never getting — the next session reconcile. Terminal
 * runtimes are released renderer-side only; the close path disposes the host
 * sessions itself.
 */
export function removeWorkspaceWindowsFromCanvases(workspaceId: string): void {
	if (!workspaceId) return;
	for (const store of getAllCanvasStores()) {
		const state = store.getState();
		const windows = Object.values(state.windows).filter(
			(window) => window.workspaceId === workspaceId,
		);
		if (windows.length === 0) continue;
		for (const window of windows) {
			if (window.kind !== "terminal") continue;
			const { terminalId } = window.data as CanvasTerminalData;
			terminalRuntimeRegistry.release(terminalId, window.id);
		}
		state.removeWindows(windows.map((window) => window.id));
	}
}
