import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMcpCaller } from "../../caller";
import { defineTool } from "../../define-tool";

export function register(server: McpServer): void {
	defineTool(server, {
		name: "workspaces_update",
		description:
			"Update fields on an existing workspace. At least one field is required.",
		inputSchema: {
			id: z.string().uuid().describe("Workspace UUID."),
			name: z.string().min(1).optional().describe("New workspace name."),
		},
		handler: async (input, ctx) => {
			const { id: _id, ...fields } = input;
			if (Object.keys(fields).length === 0) {
				throw new Error(
					"No fields to update. Pass at least one field such as --name.",
				);
			}
			const caller = createMcpCaller(ctx);
			return caller.v2Workspace.update(input);
		},
	});
}
