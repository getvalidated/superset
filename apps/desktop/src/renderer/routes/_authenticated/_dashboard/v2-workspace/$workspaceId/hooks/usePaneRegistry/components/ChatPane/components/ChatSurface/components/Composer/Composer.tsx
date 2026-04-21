/**
 * Minimum-viable v2 composer. Plain textarea + send button wired to
 * the legacy sendMessage mutation so the new UI is end-to-end usable
 * right now. The full Tiptap rebuild (mentions, slash commands, draft
 * persistence, optID-based optimistic, attachments, model picker) is
 * Phase 5's follow-up work tracked in
 * 20260421-v2-chat-refactor-phased-plan.md §5.
 */

import { Button } from "@superset/ui/button";
import { ArrowUp, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { composerDraftKey, useComposerDraftStore } from "./draft";

export interface ComposerProps {
	/** Submit a plain text message. Returns once the request is made. */
	onSubmit: (text: string) => Promise<void>;
	/** Abort current agent response, if running. */
	onStop?: () => Promise<void>;
	/** Whether the agent is currently generating. */
	isRunning?: boolean;
	/** Whether any blocking dock is visible (approval/question/plan). */
	blockedByDock?: boolean;
	/** Placeholder — usually workspace-scoped hint. */
	placeholder?: string;
	/** Auto-focus on mount (e.g. when pane gains focus). */
	autoFocus?: boolean;
	/**
	 * Identity of the draft to persist. When provided, the textarea
	 * hydrates from localStorage (Phase 5.3) and auto-saves changes
	 * with a 300ms debounce + beforeunload flush.
	 */
	workspaceId?: string;
	sessionId?: string | null;
}

export function Composer({
	onSubmit,
	onStop,
	isRunning = false,
	blockedByDock = false,
	placeholder = "Send a message…",
	autoFocus = false,
	workspaceId,
	sessionId,
}: ComposerProps) {
	const draftKey =
		workspaceId !== undefined
			? composerDraftKey(workspaceId, sessionId ?? null)
			: null;

	const persistedPrompt = useComposerDraftStore((s) =>
		draftKey ? (s.drafts[draftKey]?.prompt ?? "") : "",
	);
	const setDraftPrompt = useComposerDraftStore((s) => s.setPrompt);
	const clearDraft = useComposerDraftStore((s) => s.clearDraft);

	const [text, setText] = useState(persistedPrompt);
	const ref = useRef<HTMLTextAreaElement>(null);

	// Track the last value we wrote ourselves so we can skip save effects
	// that would only echo the store's own state back at it.
	const lastPersistedRef = useRef(persistedPrompt);

	// Rehydrate when the draftKey changes (switching sessions, new chat
	// promotion when first message creates a real sessionId, etc.).
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — only re-hydrate on identity change
	useEffect(() => {
		setText(persistedPrompt);
		lastPersistedRef.current = persistedPrompt;
	}, [draftKey]);

	// Save on every change — debounced storage layer coalesces writes.
	// Guard: skip when the new text equals the last value we pushed, or
	// when we're echoing back the store's own value.
	useEffect(() => {
		if (!draftKey) return;
		if (text === lastPersistedRef.current) return;
		lastPersistedRef.current = text;
		setDraftPrompt(draftKey, text);
	}, [draftKey, text, setDraftPrompt]);

	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus]);

	// Auto-grow the textarea up to a sensible max.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
	}, [text]);

	// Textarea is only disabled when a blocking dock is up. Submit-in-flight
	// does NOT disable input — users can keep typing (followup queue will
	// catch the next message if the agent is still running).
	const disabled = blockedByDock;

	const doSubmit = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || disabled) return;
		// Clear input + draft immediately — user should see their text
		// disappear the moment they hit Enter, with the optimistic user
		// message appearing in the timeline. We deliberately do NOT
		// await: this lets the composer accept the next message while
		// the agent is still thinking about the previous one.
		setText("");
		if (draftKey) clearDraft(draftKey);
		Promise.resolve(onSubmit(trimmed)).catch((error) => {
			// Submit failed — restore text so the user can retry.
			setText(trimmed);
			console.error("composer submit failed", error);
		});
	}, [text, onSubmit, disabled, draftKey, clearDraft]);

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
			e.preventDefault();
			void doSubmit();
		}
	};

	return (
		<div className="border-border bg-background mx-auto w-full max-w-3xl rounded-md border px-3 py-2 shadow-sm">
			<textarea
				ref={ref}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={onKeyDown}
				placeholder={
					blockedByDock
						? "Respond to the dock above to continue…"
						: placeholder
				}
				disabled={blockedByDock}
				rows={1}
				className="placeholder:text-muted-foreground w-full resize-none bg-transparent text-sm focus:outline-none disabled:opacity-50"
			/>
			<div className="mt-2 flex items-center justify-between">
				<div className="text-muted-foreground text-[11px]">
					Enter to send · Shift+Enter for newline
				</div>
				{isRunning && onStop ? (
					<Button
						size="sm"
						variant="secondary"
						onClick={() => void onStop()}
					>
						<Square className="mr-1 size-3" /> Stop
					</Button>
				) : (
					<Button
						size="sm"
						onClick={() => void doSubmit()}
						disabled={disabled || !text.trim()}
					>
						<ArrowUp className="mr-1 size-3" /> Send
					</Button>
				)}
			</div>
		</div>
	);
}
