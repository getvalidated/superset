import { electronTrpc } from "renderer/lib/electron-trpc";

export type EditCommand = "undo" | "redo";

/** Fired on `window` when Edit ▸ Undo/Redo isn't claimed by a text field or
 *  webview — app surfaces with their own history (the canvas) listen for it. */
export const EDIT_COMMAND_EVENT = "superset:edit-command";

export interface EditCommandEventDetail {
	command: EditCommand;
}

function isTextEditingElement(element: Element | null): boolean {
	if (!(element instanceof HTMLElement)) return false;
	if (element.isContentEditable) return true;
	const tag = element.tagName;
	return tag === "INPUT" || tag === "TEXTAREA";
}

/**
 * Routes Edit ▸ Undo/Redo menu clicks (and their ⌘Z/⌘⇧Z accelerators, which
 * the menu swallows before the renderer sees a keydown). Focused text fields
 * and webviews get their native editing undo back; everything else is
 * re-broadcast as a DOM event for app-level histories.
 */
export function EditMenuListener() {
	electronTrpc.menu.subscribe.useSubscription(undefined, {
		onData: (event) => {
			if (event.type !== "edit-command") return;
			const { command } = event.data;
			const focused = document.activeElement;
			if (focused instanceof HTMLElement && focused.tagName === "WEBVIEW") {
				const webview = focused as Electron.WebviewTag;
				if (command === "undo") webview.undo();
				else webview.redo();
				return;
			}
			if (isTextEditingElement(focused)) {
				// The xterm helper textarea has no meaningful edit history.
				if (focused instanceof HTMLElement && focused.closest(".xterm")) {
					return;
				}
				document.execCommand(command);
				return;
			}
			window.dispatchEvent(
				new CustomEvent<EditCommandEventDetail>(EDIT_COMMAND_EVENT, {
					detail: { command },
				}),
			);
		},
	});

	return null;
}
