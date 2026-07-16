import { describe, expect, it } from "bun:test";
import {
	collectAttachedTerminalIds,
	getAdoptableSessions,
} from "./getAdoptableSessions";

function session(terminalId: string, createdAt = 0, exited = false) {
	return { terminalId, createdAt, exited };
}

describe("collectAttachedTerminalIds", () => {
	it("collects terminal ids across tabs and skips other pane kinds", () => {
		const tabs: Array<{
			panes: Record<string, { kind: string; data: unknown }>;
		}> = [
			{
				panes: {
					a: { kind: "terminal", data: { terminalId: "t1" } },
					b: { kind: "browser", data: { url: "https://x" } },
				},
			},
			{
				panes: {
					c: { kind: "terminal", data: { terminalId: "t2" } },
					d: { kind: "terminal", data: {} },
				},
			},
		];

		expect([...collectAttachedTerminalIds(tabs)].sort()).toEqual(["t1", "t2"]);
	});

	it("accumulates into a provided set", () => {
		const into = new Set(["seed"]);
		collectAttachedTerminalIds(
			[{ panes: { a: { kind: "terminal", data: { terminalId: "t1" } } } }],
			into,
		);

		expect([...into].sort()).toEqual(["seed", "t1"]);
	});
});

describe("getAdoptableSessions", () => {
	it("skips attached, backgrounded, and exited sessions", () => {
		const result = getAdoptableSessions({
			sessions: [
				session("attached"),
				session("backgrounded"),
				session("exited", 0, true),
				session("adoptme"),
			],
			attachedTerminalIds: new Set(["attached"]),
			backgroundTerminalIds: ["backgrounded"],
		});

		expect(result.map((s) => s.terminalId)).toEqual(["adoptme"]);
	});

	it("orders by creation time, oldest first", () => {
		const result = getAdoptableSessions({
			sessions: [session("late", 30), session("early", 10), session("mid", 20)],
			attachedTerminalIds: new Set(),
			backgroundTerminalIds: [],
		});

		expect(result.map((s) => s.terminalId)).toEqual(["early", "mid", "late"]);
	});
});
