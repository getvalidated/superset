import { describe, expect, mock, test } from "bun:test";
import type { Terminal as XTerm } from "@xterm/xterm";
import { createKeyEventHandler } from "./terminal-runtime";

interface StubEventInit {
	type?: string;
	key?: string;
	code?: string;
	shiftKey?: boolean;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
}

function stubEvent(init: StubEventInit): KeyboardEvent {
	return {
		type: init.type ?? "keydown",
		key: init.key ?? "",
		code: init.code ?? "",
		shiftKey: !!init.shiftKey,
		metaKey: !!init.metaKey,
		ctrlKey: !!init.ctrlKey,
		altKey: !!init.altKey,
		preventDefault: mock(() => {}),
	} as unknown as KeyboardEvent;
}

function stubTerminal() {
	return {
		input: mock((_data: string, _wasUserInput?: boolean) => {}),
		hasSelection: mock(() => false),
		selectAll: mock(() => {}),
	} as unknown as XTerm;
}

describe("createKeyEventHandler — Shift+Enter (#3706)", () => {
	test("Shift+Enter sends ESC+CR to the PTY, not a bare CR", () => {
		// v1 terminals wrote ESC+CR directly (helpers.ts:setupKeyboardHandler).
		// v2 relied on xterm.js's kitty protocol to emit `\x1b[13;2u` for
		// Shift+Enter, but @xterm/xterm 6.1.0-beta.197's incomplete kitty
		// support sends a bare `\r` — indistinguishable from plain Enter,
		// causing Claude Code and other TUIs to submit instead of inserting
		// a newline. The handler must intercept Shift+Enter before xterm's
		// default encoder runs and write ESC+CR itself.
		const terminal = stubTerminal();
		const handler = createKeyEventHandler(terminal);

		const event = stubEvent({
			type: "keydown",
			key: "Enter",
			code: "Enter",
			shiftKey: true,
		});

		const result = handler(event);

		expect(result).toBe(false);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(terminal.input).toHaveBeenCalledWith("\x1b\r", true);
	});

	test("Shift+Enter keyup does not emit a second ESC+CR", () => {
		const terminal = stubTerminal();
		const handler = createKeyEventHandler(terminal);

		const event = stubEvent({
			type: "keyup",
			key: "Enter",
			code: "Enter",
			shiftKey: true,
		});

		const result = handler(event);

		expect(result).toBe(false);
		expect(terminal.input).not.toHaveBeenCalled();
	});

	test("plain Enter still bubbles to xterm (default CR handling)", () => {
		const terminal = stubTerminal();
		const handler = createKeyEventHandler(terminal);

		const event = stubEvent({
			type: "keydown",
			key: "Enter",
			code: "Enter",
		});

		const result = handler(event);

		expect(result).toBe(true);
		expect(terminal.input).not.toHaveBeenCalled();
	});

	test("Ctrl+Shift+Enter is not intercepted as a newline chord", () => {
		const terminal = stubTerminal();
		const handler = createKeyEventHandler(terminal);

		const event = stubEvent({
			type: "keydown",
			key: "Enter",
			code: "Enter",
			shiftKey: true,
			ctrlKey: true,
		});

		const result = handler(event);

		expect(result).toBe(true);
		expect(terminal.input).not.toHaveBeenCalled();
	});
});
