import { describe, expect, it } from "bun:test";
import { translateLineEditChord } from "./line-edit-translations";

function event(overrides: Partial<KeyboardEvent>): KeyboardEvent {
	return {
		key: "",
		metaKey: false,
		altKey: false,
		ctrlKey: false,
		shiftKey: false,
		...overrides,
	} as KeyboardEvent;
}

describe("translateLineEditChord", () => {
	it("maps Mac Cmd+Enter to the TUI newline sequence", () => {
		expect(
			translateLineEditChord(event({ key: "Enter", metaKey: true }), {
				isMac: true,
				isWindows: false,
			}),
		).toBe("\x1b\r");
	});

	it("does not map Cmd+Shift+Enter", () => {
		expect(
			translateLineEditChord(
				event({ key: "Enter", metaKey: true, shiftKey: true }),
				{ isMac: true, isWindows: false },
			),
		).toBeNull();
	});

	it("does not map Enter on non-Mac platforms", () => {
		expect(
			translateLineEditChord(event({ key: "Enter", metaKey: true }), {
				isMac: false,
				isWindows: true,
			}),
		).toBeNull();
	});

	// Regression guard for #5412: Cmd+Backspace must clear the line (Ctrl+U,
	// \x15) WITHOUT appending a cursor-left (\x1b[D). The trailing left-arrow
	// leaked into full-screen TUIs (e.g. Claude Code) as a real navigation
	// keystroke, making Cmd+Backspace behave like pressing Left.
	it("maps Mac Cmd+Backspace to Ctrl+U only (no stray Left-arrow)", () => {
		const result = translateLineEditChord(
			event({ key: "Backspace", metaKey: true }),
			{ isMac: true, isWindows: false },
		);
		expect(result).toBe("\x15");
		// The stray cursor-left byte sequence must never be appended.
		expect(result).not.toContain("\x1b[D");
	});

	it("maps Mac Cmd+ArrowLeft/Right to line start/end (not raw arrows)", () => {
		expect(
			translateLineEditChord(event({ key: "ArrowLeft", metaKey: true }), {
				isMac: true,
				isWindows: false,
			}),
		).toBe("\x01");
		expect(
			translateLineEditChord(event({ key: "ArrowRight", metaKey: true }), {
				isMac: true,
				isWindows: false,
			}),
		).toBe("\x05");
	});
});
