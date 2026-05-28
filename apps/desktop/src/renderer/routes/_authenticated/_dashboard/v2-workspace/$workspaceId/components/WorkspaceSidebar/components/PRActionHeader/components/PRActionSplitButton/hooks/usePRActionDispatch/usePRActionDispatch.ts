import { toast } from "@superset/ui/sonner";
import { useCallback } from "react";
import type { AgentTarget } from "renderer/hooks/agents/useAgentTarget";
import { useSendToTerminalAgent } from "renderer/hooks/host-service/useSendToTerminalAgent";
import {
	type PRFlowDispatch,
	planDispatch,
} from "../../../../../../hooks/usePRFlowDispatch/usePRFlowDispatch";
import { buildPRContext } from "../../../../utils/buildPRContext";
import type { PRFlowState } from "../../../../utils/getPRFlowState";

export type PRActionCreateNewAgentSession = (input: {
	configId: string;
	placement: "split-pane" | "new-tab";
	prompt: string;
}) => Promise<{ terminalId: string } | null>;

interface UsePRActionDispatchArgs {
	workspaceId: string;
	/** Legacy chat-tab path used when no agent target is selected. */
	flowDispatch: PRFlowDispatch;
	onCreateNewAgentSession?: PRActionCreateNewAgentSession;
	/** Focus an existing terminal pane after a successful send. Without
	 *  this, the user clicks the button and the message lands in an
	 *  off-screen pane with no visible feedback. */
	onFocusExistingTerminal?: (terminalId: string) => void;
}

interface SubmitArgs {
	state: PRFlowState;
	target: AgentTarget | null;
}

/**
 * Routes a PR-action submit to the right transport based on the chosen
 * agent target.
 *
 * - `null` target → legacy `flowDispatch` (opens a chat tab with the slash
 *   command + `pr-context.md` attachment). Used when no agent has been
 *   picked yet.
 * - `existing` target → sends the slash command + inlined pr-context to
 *   the terminal agent via xterm. Terminals can't carry separate file
 *   attachments through the channel, so the context is fenced inline.
 * - `new` target → launches the preset with the same inlined seed
 *   prompt; the host bakes the prompt into the agent's argv/stdin.
 */
export function usePRActionDispatch({
	workspaceId,
	flowDispatch,
	onCreateNewAgentSession,
	onFocusExistingTerminal,
}: UsePRActionDispatchArgs) {
	const { send: sendToTerminalAgent } = useSendToTerminalAgent();

	return useCallback(
		async ({ state, target }: SubmitArgs) => {
			if (!target) {
				flowDispatch({ state, draft: false });
				return;
			}

			const plan = planDispatch(state, { draft: false });
			if (!plan) return; // state isn't actionable

			const verb = state.kind === "pr-exists" ? "Updating" : "Creating";
			const inlined = formatInlinedPrompt(plan.prompt, state);

			if (target.kind === "existing") {
				try {
					await sendToTerminalAgent({
						workspaceId,
						terminalId: target.terminalId,
						text: inlined,
					});
					onFocusExistingTerminal?.(target.terminalId);
					toast.success(`${verb} PR with agent`);
				} catch {
					// useSendToTerminalAgent surfaces its own error toast.
				}
				return;
			}

			if (!onCreateNewAgentSession) {
				toast.error("Couldn't start a new agent session");
				return;
			}
			const result = await onCreateNewAgentSession({
				configId: target.configId,
				placement: target.placement,
				prompt: inlined,
			});
			if (result) toast.success(`${verb} PR in new agent session`);
		},
		[
			workspaceId,
			flowDispatch,
			sendToTerminalAgent,
			onCreateNewAgentSession,
			onFocusExistingTerminal,
		],
	);
}

function formatInlinedPrompt(prompt: string, state: PRFlowState): string {
	const context = buildPRContext(state);
	// Inline PR context with a heading the skill recognises. Keep the
	// `pr-context.md` reference so the skill body's "file attachment or
	// inlined" framing reads naturally either way.
	return `${prompt}\n\n**pr-context.md**\n\n${context}`;
}
