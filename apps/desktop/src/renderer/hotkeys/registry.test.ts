import { describe, expect, it } from "bun:test";
import { HOTKEYS_REGISTRY } from "./registry";
import { canonicalizeChord } from "./utils/resolveHotkeyFromEvent";

// Regression for #3623 — "cmd + left/right does not change tabs anymore".
// Asserts the raw per-platform chord strings in the registry so the test is
// independent of the runtime `navigator.platform` (Bun reports Linux).
//
// The tab-navigation chord for Mac is the bare ⌘←/⌘→ pair; requiring an
// additional Alt modifier breaks the shortcut users rely on. On Windows/Linux
// the equivalent is Ctrl+Shift+Arrow (avoiding Ctrl+Arrow, which the OS uses
// for word-by-word text navigation).
describe("tab navigation hotkeys (#3623)", () => {
	it("binds PREV_TAB to meta+left on mac", () => {
		expect(HOTKEYS_REGISTRY.PREV_TAB.key.mac).toBe("meta+left");
	});

	it("binds NEXT_TAB to meta+right on mac", () => {
		expect(HOTKEYS_REGISTRY.NEXT_TAB.key.mac).toBe("meta+right");
	});

	it("binds PREV_TAB/NEXT_TAB without the alt modifier on mac", () => {
		expect(HOTKEYS_REGISTRY.PREV_TAB.key.mac).not.toContain("alt");
		expect(HOTKEYS_REGISTRY.NEXT_TAB.key.mac).not.toContain("alt");
	});

	it("resolves the mac PREV_TAB chord to the cmd+left event chord", () => {
		// eventToChord for { code: "ArrowLeft", metaKey: true } produces
		// "meta+arrowleft"; the registered chord must canonicalize to the same.
		expect(canonicalizeChord(HOTKEYS_REGISTRY.PREV_TAB.key.mac ?? "")).toBe(
			"meta+arrowleft",
		);
	});

	it("resolves the mac NEXT_TAB chord to the cmd+right event chord", () => {
		expect(canonicalizeChord(HOTKEYS_REGISTRY.NEXT_TAB.key.mac ?? "")).toBe(
			"meta+arrowright",
		);
	});
});
