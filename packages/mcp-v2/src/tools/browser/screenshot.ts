import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineTool } from "../../define-tool";
import { hostServiceCall } from "../../host-service-client";
import { hostIdInput, windowInput } from "./shared";

export function register(server: McpServer): void {
	defineTool(server, {
		name: "browser_screenshot",
		description:
			"Capture a PNG screenshot of a browser window open in the Superset desktop app on a host. The image is written to disk on that host (not returned inline) and the tool returns its absolute path — read it with host-side tooling. Defaults to a per-window file under the Superset home directory; pass `outputPath` (absolute) to control the destination.",
		inputSchema: {
			hostId: hostIdInput,
			window: windowInput,
			outputPath: z
				.string()
				.optional()
				.describe(
					"Absolute path on the host to write the PNG to. Defaults to <superset-home>/browser-screenshots/<paneId>.png.",
				),
		},
		handler: async (input, ctx) => {
			return hostServiceCall<{
				paneId: string;
				title: string;
				url: string;
				path: string;
			}>(
				{
					relayUrl: ctx.relayUrl,
					organizationId: ctx.organizationId,
					hostId: input.hostId,
					jwt: ctx.bearerToken,
				},
				"browser.screenshot",
				"mutation",
				{ window: input.window, outputPath: input.outputPath },
			);
		},
	});
}
