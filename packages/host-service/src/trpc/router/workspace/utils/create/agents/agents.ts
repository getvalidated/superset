import { TRPCError } from "@trpc/server";
import { buildPromptCommandString } from "@superset/shared/agent-prompt-launch";
import { eq } from "drizzle-orm";
import { hostAgentConfigs } from "../../../../../../db/schema";
import { createTerminalSessionInternal } from "../../../../../../terminal/terminal";
import { resolveAttachmentPath } from "../../../../attachments";
import type { HostServiceContext } from "../../../../../../types";

export interface AgentLaunchOutput {
	terminalId: string;
	label: string;
}

export interface ChatLaunchOutput {
	chatSessionId: string;
	label?: string;
}

export interface SpawnArgs {
	ctx: HostServiceContext;
	workspaceId: string;
	prompt: string;
	attachmentIds: string[];
}

function attachAttachmentBlock(prompt: string, attachmentIds: string[]) {
	const resolved: string[] = [];
	const warnings: string[] = [];
	for (const id of attachmentIds) {
		const r = resolveAttachmentPath(id);
		if (!r) {
			warnings.push(`Attachment "${id}" not found on host — skipping`);
			continue;
		}
		resolved.push(r.path);
	}
	const finalPrompt =
		resolved.length > 0
			? `${prompt}\n\n# Attached files\n\n${resolved.map((p) => `- ${p}`).join("\n")}`
			: prompt;
	return { finalPrompt, warnings };
}

export function spawnAgentTerminal(
	args: SpawnArgs & { agentId: string },
): { result: AgentLaunchOutput | null; warnings: string[] } {
	const config = args.ctx.db
		.select({
			label: hostAgentConfigs.label,
			launchCommand: hostAgentConfigs.launchCommand,
			promptInput: hostAgentConfigs.promptInput,
		})
		.from(hostAgentConfigs)
		.where(eq(hostAgentConfigs.id, args.agentId))
		.get();

	if (!config) {
		return {
			result: null,
			warnings: [`Agent config "${args.agentId}" not found — skipping launch`],
		};
	}

	const { finalPrompt, warnings } = attachAttachmentBlock(
		args.prompt,
		args.attachmentIds,
	);

	const terminalId = crypto.randomUUID();
	const command = buildPromptCommandString({
		command: config.launchCommand,
		transport: config.promptInput,
		prompt: finalPrompt,
		randomId: terminalId,
	});

	const result = createTerminalSessionInternal({
		terminalId,
		workspaceId: args.workspaceId,
		db: args.ctx.db,
		initialCommand: command,
	});

	if ("error" in result) {
		warnings.push(`Failed to start agent terminal: ${result.error}`);
		return { result: null, warnings };
	}

	return { result: { terminalId, label: config.label }, warnings };
}

export function spawnAgentChat(
	_args: SpawnArgs & { model: string },
): { result: ChatLaunchOutput | null; warnings: string[] } {
	throw new TRPCError({
		code: "NOT_IMPLEMENTED",
		message:
			"Chat launches will be wired up when chat configuration gets a V2 surface",
	});
}
