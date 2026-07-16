import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineTool } from "../../define-tool";
import { hostServiceCall } from "../../host-service-client";
import { hostIdInput, windowInput } from "./shared";

export function register(server: McpServer): void {
	defineTool(server, {
		name: "browser_reload",
		description:
			"Reload a browser window open in the Superset desktop app on a host. Pass `hard: true` to bypass the cache (equivalent to shift-reload). Use after a dev-server rebuild to refresh the page an agent or user is looking at.",
		inputSchema: {
			hostId: hostIdInput,
			window: windowInput,
			hard: z
				.boolean()
				.optional()
				.describe("Reload ignoring the HTTP cache. Defaults to false."),
		},
		handler: async (input, ctx) => {
			return hostServiceCall<{
				paneId: string;
				title: string;
				url: string;
				reloaded: boolean;
			}>(
				{
					relayUrl: ctx.relayUrl,
					organizationId: ctx.organizationId,
					hostId: input.hostId,
					jwt: ctx.bearerToken,
				},
				"browser.reload",
				"mutation",
				{ window: input.window, hard: input.hard },
			);
		},
	});
}
