import { describe, expect, test } from "bun:test";
import { createCanvasStore } from "./canvasStore";
import type { CanvasWindow } from "./canvasStore";
import { pruneOrphanTerminalWindows } from "./useCanvasSeeding";

function terminalWindow(id: string, workspaceId: string): CanvasWindow {
	return {
		id: `term:${id}`,
		kind: "terminal",
		workspaceId,
		x: 0,
		y: 0,
		width: 400,
		height: 300,
		data: { terminalId: id },
	};
}

function seed(windows: CanvasWindow[]) {
	const store = createCanvasStore();
	store.getState().upsertWindows(windows);
	return store;
}

describe("pruneOrphanTerminalWindows", () => {
	test("removes a terminal window whose workspace and session are both gone", () => {
		const store = seed([terminalWindow("t1", "ws-closed")]);
		pruneOrphanTerminalWindows({
			store,
			knownWorkspaceIds: new Set(["ws-open"]),
			claimedTerminalIds: new Set(),
		});
		expect(Object.keys(store.getState().windows)).toEqual([]);
	});

	test("keeps a window whose workspace still exists somewhere", () => {
		const store = seed([terminalWindow("t1", "ws-open")]);
		pruneOrphanTerminalWindows({
			store,
			knownWorkspaceIds: new Set(["ws-open"]),
			claimedTerminalIds: new Set(),
		});
		expect(store.getState().windows["term:t1"]).toBeDefined();
	});

	test("keeps a window whose session a host still claims, even without a workspace row", () => {
		const store = seed([terminalWindow("t1", "ws-closed")]);
		pruneOrphanTerminalWindows({
			store,
			knownWorkspaceIds: new Set(),
			claimedTerminalIds: new Set(["t1"]),
		});
		expect(store.getState().windows["term:t1"]).toBeDefined();
	});

	test("ignores non-terminal windows in orphaned workspaces", () => {
		const store = seed([
			{
				id: "browser-1",
				kind: "browser",
				workspaceId: "ws-closed",
				x: 0,
				y: 0,
				width: 400,
				height: 300,
				data: { url: "about:blank" },
			},
			terminalWindow("t1", "ws-closed"),
		]);
		pruneOrphanTerminalWindows({
			store,
			knownWorkspaceIds: new Set(),
			claimedTerminalIds: new Set(),
		});
		expect(Object.keys(store.getState().windows)).toEqual(["browser-1"]);
	});
});
