import { toast } from "@superset/ui/sonner";
import { useCallback } from "react";
import type { AgentTarget } from "renderer/hooks/agents/useAgentTarget";
import { useSendToTerminalAgent } from "renderer/hooks/host-service/useSendToTerminalAgent";
import {
	formatInlinedPRPrompt,
	type OpenChatFn,
	planDispatch,
} from "../../../../../../hooks/planDispatch";
import type { PRFlowState } from "../../../../utils/getPRFlowState";

export type PRActionCreateNewAgentSession = (input: {
	configId: string;
	placement: "split-pane" | "new-tab";
	prompt: string;
}) => Promise<{ terminalId: string } | null>;

interface UsePRActionDispatchArgs {
	workspaceId: string;
	/** Opens a fresh chat tab with the slash command + pr-context.md
	 *  attachment. Used as the fallback transport when no agent target is
	 *  selected. */
	onOpenChat?: OpenChatFn;
	onCreateNewAgentSession?: PRActionCreateNewAgentSession;
	/** Focus an existing terminal pane after a successful send. Without
	 *  this, the user clicks the button and the message lands in an
	 *  off-screen pane with no visible feedback. */
	onFocusExistingTerminal?: (terminalId: string) => void;
	/** Per-project guidelines from `.superset/pr-prompt.md`. When non-empty,
	 *  appended to every dispatched `pr-context.md` payload. */
	projectPrompt?: string | null;
}

interface SubmitArgs {
	state: PRFlowState;
	target: AgentTarget | null;
}

/**
 * Routes a PR-action submit to the right transport based on the chosen
 * agent target.
 *
 * - `null` target → opens a chat tab via `onOpenChat` with the slash
 *   command + `pr-context.md` attachment. Used when no agent has been
 *   picked yet (or none exists in the workspace).
 * - `existing` target → sends the slash command + inlined pr-context to
 *   the terminal agent via xterm. Terminals can't carry separate file
 *   attachments through the channel, so the context is fenced inline.
 * - `new` target → launches the preset with the same inlined seed
 *   prompt; the host bakes the prompt into the agent's argv/stdin.
 *
 * The per-project `.superset/pr-prompt.md` (when present) is appended to
 * the pr-context payload as a `## Project guidelines` section that the
 * slash command honours.
 */
export function usePRActionDispatch({
	workspaceId,
	onOpenChat,
	onCreateNewAgentSession,
	onFocusExistingTerminal,
	projectPrompt,
}: UsePRActionDispatchArgs) {
	const { send: sendToTerminalAgent } = useSendToTerminalAgent();

	return useCallback(
		async ({ state, target }: SubmitArgs) => {
			const plan = planDispatch(state, { draft: false, projectPrompt });
			if (!plan) return; // state isn't actionable

			if (!target) {
				if (!onOpenChat) {
					toast.error("Couldn't open a chat to dispatch the PR");
					return;
				}
				onOpenChat({
					initialPrompt: plan.prompt,
					initialFiles: [plan.attachment],
				});
				return;
			}

			const verb = state.kind === "pr-exists" ? "Updating" : "Creating";
			const inlined = formatInlinedPRPrompt(plan);

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
			onOpenChat,
			sendToTerminalAgent,
			onCreateNewAgentSession,
			onFocusExistingTerminal,
			projectPrompt,
		],
	);
}
