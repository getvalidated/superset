import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool } from "../../define-tool";
import { hostServiceCall } from "../../host-service-client";
import { type BrowserWindowInfo, hostIdInput } from "./shared";

export function register(server: McpServer): void {
	defineTool(server, {
		name: "browser_windows_list",
		description:
			"List the browser windows (embedded web panes) currently open in the Superset desktop app on a host. Returns each window's paneId, page title, URL, and loading state. Use to find a `window` value for `browser_screenshot` or `browser_reload`. Only works on hosts running the desktop app — headless hosts have no browser.",
		inputSchema: {
			hostId: hostIdInput,
		},
		handler: async (input, ctx) => {
			return hostServiceCall<{ windows: BrowserWindowInfo[] }>(
				{
					relayUrl: ctx.relayUrl,
					organizationId: ctx.organizationId,
					hostId: input.hostId,
					jwt: ctx.bearerToken,
				},
				"browser.listWindows",
				"query",
			);
		},
	});
}
