import { z } from "zod";
import { PROMPT_TRANSPORTS } from "./agent-prompt-launch";
import { BUILTIN_TERMINAL_AGENTS } from "./builtin-terminal-agents";

export const hostAgentPromptInputSchema = z.enum(PROMPT_TRANSPORTS);
export type HostAgentPromptInput = z.infer<typeof hostAgentPromptInputSchema>;

export const agentPresetSchema = z.object({
	presetId: z.string().min(1),
	label: z.string().min(1),
	launchCommand: z.string().min(1),
	promptInput: hostAgentPromptInputSchema,
});
export type AgentPreset = z.infer<typeof agentPresetSchema>;

export const hostAgentConfigSchema = agentPresetSchema.extend({
	id: z.string().min(1),
	order: z.number().int().nonnegative(),
	userModified: z.boolean(),
});
export type HostAgentConfig = z.infer<typeof hostAgentConfigSchema>;

export const HOST_AGENT_PRESETS: AgentPreset[] = BUILTIN_TERMINAL_AGENTS.map(
	(agent) => ({
		presetId: agent.id,
		label: agent.label,
		launchCommand: agent.promptCommand || agent.command,
		promptInput: agent.promptTransport,
	}),
);

export function normalizeHostAgentConfigs(
	configs: HostAgentConfig[],
): HostAgentConfig[] {
	return [...configs]
		.sort((a, b) => a.order - b.order)
		.map((config, index) => ({ ...config, order: index }));
}
