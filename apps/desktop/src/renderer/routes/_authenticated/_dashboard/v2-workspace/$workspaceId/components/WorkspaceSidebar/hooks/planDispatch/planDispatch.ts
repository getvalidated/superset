import type { ChatPaneData } from "../../../../types";
import { buildPRContext } from "../../components/PRActionHeader/utils/buildPRContext";
import type { PRFlowState } from "../../components/PRActionHeader/utils/getPRFlowState";

/** Callback that opens a chat pane pre-populated with a slash command and
 *  a synthesized `pr-context.md` attachment. The v2 workspace page wires
 *  this to `store.getState().addTab({ kind: "chat", ... })`. */
export type OpenChatFn = (launchConfig: ChatPaneData["launchConfig"]) => void;

export interface DispatchPlan {
	prompt: string;
	contextMarkdown: string;
	attachment: {
		data: string;
		mediaType: string;
		filename: string;
	};
}

export interface PlanDispatchOptions {
	draft: boolean;
	/** Per-project guidelines from `.superset/pr-prompt.md`. Appended to
	 *  the `pr-context.md` payload as a "Project guidelines" section that
	 *  the slash command honours. Empty/null skips the section. */
	projectPrompt?: string | null;
}

export function planDispatch(
	state: PRFlowState,
	options: PlanDispatchOptions,
): DispatchPlan | null {
	const slash = (() => {
		if (state.kind === "no-pr") {
			return options.draft ? "/pr/create-pr --draft" : "/pr/create-pr";
		}
		if (state.kind === "pr-exists") return "/pr/update-pr";
		return null;
	})();
	if (!slash) return null;

	const markdown = buildPRContext(state, {
		projectPrompt: options.projectPrompt,
	});
	return {
		prompt: slash,
		contextMarkdown: markdown,
		attachment: {
			data: encodeAsDataUrl(markdown, "text/markdown"),
			mediaType: "text/markdown",
			filename: "pr-context.md",
		},
	};
}

/**
 * Format the seed prompt for terminal / new-session transports — they
 * can't carry the pr-context.md as a separate file attachment through
 * the xterm channel, so the markdown is fenced inline under a heading
 * the slash command recognises. Extracted so future tweaks to the
 * agent-facing format stay testable.
 */
export function formatInlinedPRPrompt(plan: DispatchPlan): string {
	return `${plan.prompt}\n\n**pr-context.md**\n\n${plan.contextMarkdown}`;
}

function encodeAsDataUrl(content: string, mediaType: string): string {
	// `unescape` is removed from WHATWG; use TextEncoder for UTF-8 → base64.
	// Branch names + commit messages can carry non-ASCII characters.
	const base64 =
		typeof btoa === "function"
			? btoa(
					Array.from(new TextEncoder().encode(content), (b) =>
						String.fromCharCode(b),
					).join(""),
				)
			: Buffer.from(content, "utf-8").toString("base64");
	return `data:${mediaType};base64,${base64}`;
}
