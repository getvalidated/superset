import { alert } from "@superset/ui/atoms/Alert";
import { getBaseName } from "renderer/lib/pathBasename";
import { confirmCloseTerminals } from "renderer/lib/terminal/confirm-close-terminals";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import type { StoreApi } from "zustand/vanilla";
import { getDocument } from "../$workspaceId/state/fileDocumentStore";
import type { FilePaneData } from "../$workspaceId/types";
import type { CanvasStore, CanvasWindow } from "./canvasStore";
import type { CanvasTerminalData } from "./useCanvasSeeding";
import type { CanvasTerminalLifecycle } from "./useCanvasTerminalLifecycle";

const CLOSE_TERMINAL_LABELS = {
	title: "A process is still running in this terminal",
	description: "Closing this terminal will end the running process.",
	confirmLabel: "Close terminal",
};

function dismissWindow(
	store: StoreApi<CanvasStore>,
	window: CanvasWindow,
	options?: DismissOptions,
) {
	if (window.kind === "terminal") {
		const { terminalId } = window.data as CanvasTerminalData;
		if (options?.terminalLifecycle) {
			// Destructive close, same semantics as closing the pane in tabs mode:
			// tear down the renderer runtime and kill the host session, so the
			// session (the shared source of truth) disappears from both views.
			terminalRuntimeRegistry.dispose(terminalId);
			options.terminalLifecycle.killSession(window.workspaceId, terminalId);
		} else {
			terminalRuntimeRegistry.release(terminalId, window.id);
		}
	}
	// Batch deletes (multi-select) push one history entry themselves.
	if (!options?.skipHistory) store.getState().pushHistory();
	store.getState().removeWindows([window.id], { dismiss: true });
}

interface DismissOptions {
	/** Caller already pushed an undo snapshot covering this removal. */
	skipHistory?: boolean;
	/** When present, dismissing a terminal window kills its host session
	 *  (after the same still-running confirm tabs mode uses). Without it the
	 *  runtime is only released and the session lives on. */
	terminalLifecycle?: CanvasTerminalLifecycle;
	/** Batch caller already ran the still-running confirm for its terminals. */
	skipTerminalConfirm?: boolean;
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
	options?: DismissOptions,
): void {
	if (
		window.kind === "terminal" &&
		options?.terminalLifecycle &&
		!options.skipTerminalConfirm
	) {
		const { terminalId } = window.data as CanvasTerminalData;
		const lifecycle = options.terminalLifecycle;
		void confirmCloseTerminals(
			[terminalId],
			(id) => lifecycle.probeRunning(window.workspaceId, id),
			CLOSE_TERMINAL_LABELS,
		).then((confirmed) => {
			if (confirmed) dismissWindow(store, window, options);
		});
		return;
	}
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
								dismissWindow(store, window, options);
								return;
							}
							const result = await current.save();
							// Keep the window open on a failed save so the user can
							// see the conflict / error state and retry.
							if (result.status === "saved") {
								dismissWindow(store, window, options);
							}
						},
					},
					{
						label: "Don't Save",
						variant: "secondary",
						onClick: async () => {
							const current = getDocument(window.workspaceId, filePath);
							if (current) await current.reload();
							dismissWindow(store, window, options);
						},
					},
					{ label: "Cancel", variant: "ghost", onClick: () => {} },
				],
			});
			return;
		}
	}
	dismissWindow(store, window, options);
}

/**
 * Dismiss a multi-selection. Terminal windows share one still-running confirm
 * (mirroring the tab-close guard) instead of stacking a dialog per window;
 * other kinds go through the regular per-window path.
 */
export function requestDismissCanvasWindows(
	store: StoreApi<CanvasStore>,
	windows: CanvasWindow[],
	options?: DismissOptions,
): void {
	const terminals = windows.filter((window) => window.kind === "terminal");
	for (const window of windows) {
		if (window.kind !== "terminal") {
			requestDismissCanvasWindow(store, window, options);
		}
	}
	if (terminals.length === 0) return;

	const lifecycle = options?.terminalLifecycle;
	if (!lifecycle) {
		for (const window of terminals) dismissWindow(store, window, options);
		return;
	}
	void confirmCloseTerminals(
		terminals.map((window) => (window.data as CanvasTerminalData).terminalId),
		(id) => {
			const owner = terminals.find(
				(window) => (window.data as CanvasTerminalData).terminalId === id,
			);
			return owner
				? lifecycle.probeRunning(owner.workspaceId, id)
				: Promise.resolve(false);
		},
		{
			title: "A process is still running in these terminals",
			description: "Closing these terminals will end the running processes.",
			confirmLabel: "Close terminals",
		},
	).then((confirmed) => {
		if (!confirmed) return;
		for (const window of terminals) {
			dismissWindow(store, window, options);
		}
	});
}
