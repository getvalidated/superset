import { describe, expect, it } from "bun:test";
import { getHostServiceUnavailableMessage } from "./host-service-unavailable";

describe("getHostServiceUnavailableMessage", () => {
	it("returns an actionable string with host context", () => {
		const message = getHostServiceUnavailableMessage(
			{
				activeOrganizationId: "1234567890abcdef",
				activeOrganizationName: "Acme",
				hostServiceStatus: "stopped",
				machineId: "abcdef1234567890",
			},
			{ action: "create the workspace" },
		);

		expect(typeof message).toBe("string");
		expect(message).toContain("Cannot create the workspace");
		expect(message).toContain('"Acme"');
		expect(message).toContain("abcdef12");
		expect(message).toContain("Status: stopped");
		expect(message).toContain("Host Service > Restart");
	});

	it("keeps missing organization as a sign-in or selection issue", () => {
		const message = getHostServiceUnavailableMessage(
			{ hostServiceStatus: "starting", machineId: "local-machine" },
			{ action: "load agent settings" },
		);

		expect(typeof message).toBe("string");
		expect(message).toContain("Cannot load agent settings");
		expect(message).toContain("no active organization is selected");
		expect(message).toContain("Select an organization or sign in again");
	});
});
