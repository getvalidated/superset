import { alert } from "@superset/ui/atoms/Alert";
import { getBaseName } from "renderer/lib/pathBasename";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import type { StoreApi } from "zustand/vanilla";
import { getDocument } from "../$workspaceId/state/fileDocumentStore";
import type { FilePaneData } from "../$workspaceId/types";
import type { CanvasStore, CanvasWindow } from "./canvasStore";
import type { CanvasTerminalData } from "./useCanvasSeeding";

function dismissWindow(store: StoreApi<CanvasStore>, window: CanvasWindow) {
	if (window.kind === "terminal") {
		const { terminalId } = window.data as CanvasTerminalData;
		terminalRuntimeRegistry.release(terminalId, window.id);
	}
	store.getState().removeWindows([window.id], { dismiss: true });
}

/**
 * Remove a window from the canvas (frame close button, Backspace on a focused
 * window). Dismissed rather than plain-removed so seeding doesn't resurrect
 * it. Mirrors the tabs registry's onBeforeClose for files: a dirty file
 * window prompts to save instead of silently dropping edits.
 */
export function requestDismissCanvasWindow(
	store: StoreApi<CanvasStore>,
	window: CanvasWindow,
): void {
	if (window.kind === "file") {
		const { filePath } = window.data as FilePaneData;
		const document = getDocument(window.workspaceId, filePath);
		if (document?.dirty) {
			const name = getBaseName(filePath);
			alert({
				title: `Do you want to save the changes you made to ${name}?`,
				description: "Your changes will be lost if you don't save them.",
				actions: [
					{
						label: "Save",
						onClick: async () => {
							const current = getDocument(window.workspaceId, filePath);
							if (!current) {
								dismissWindow(store, window);
								return;
							}
							const result = await current.save();
							// Keep the window open on a failed save so the user can
							// see the conflict / error state and retry.
							if (result.status === "saved") dismissWindow(store, window);
						},
					},
					{
						label: "Don't Save",
						variant: "secondary",
						onClick: async () => {
							const current = getDocument(window.workspaceId, filePath);
							if (current) await current.reload();
							dismissWindow(store, window);
						},
					},
					{ label: "Cancel", variant: "ghost", onClick: () => {} },
				],
			});
			return;
		}
	}
	dismissWindow(store, window);
}
