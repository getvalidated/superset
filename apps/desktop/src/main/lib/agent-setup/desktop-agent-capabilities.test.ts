import { describe, expect, it } from "bun:test";
import { AGENT_TYPES } from "@superset/shared/agent-command";
import { DESKTOP_AGENT_SETUP_TARGETS } from "./desktop-agent-capabilities";

describe("DESKTOP_AGENT_SETUP_TARGETS", () => {
	it("covers every built-in terminal agent so each one drives the working indicator", () => {
		const targetIds = new Set<string>(
			DESKTOP_AGENT_SETUP_TARGETS.map((target) => target.id),
		);
		const missing = AGENT_TYPES.filter(
			(agentType) => !targetIds.has(agentType),
		);

		expect(missing).toEqual([]);
	});

	it("includes pi so its lifecycle events reach the notify dispatcher", () => {
		const targetIds = DESKTOP_AGENT_SETUP_TARGETS.map((target) => target.id);
		expect(targetIds).toContain("pi");
	});
});
