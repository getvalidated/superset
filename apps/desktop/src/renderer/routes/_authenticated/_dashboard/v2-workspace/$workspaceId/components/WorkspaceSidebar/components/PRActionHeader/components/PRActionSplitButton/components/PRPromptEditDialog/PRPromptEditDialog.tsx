import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Textarea } from "@superset/ui/textarea";
import { useEffect, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import {
	PR_PROMPT_RELATIVE_PATH,
	useProjectPRPrompt,
} from "../../../../hooks/useProjectPRPrompt";

interface PRPromptEditDialogProps {
	workspaceId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Optional deep-link: opens `.superset/pr-prompt.md` as a v2 file tab.
	 *  When omitted, the "Open in editor" affordance is hidden. */
	onOpenInEditor?: (absolutePath: string) => void;
}

const PLACEHOLDER = `Add project-specific PR guidance the agent should always follow.
Examples:
  - Title format: feat(scope): description
  - Always include a "Test plan" section with concrete steps
  - Default to draft PRs unless the changes are user-facing`;

/**
 * Edit-prompt dialog opened from the PR action chevron menu. Reads + writes
 * `.superset/pr-prompt.md` for the current workspace. The file is optional
 * — when present, its contents are appended to every PR dispatch's
 * `pr-context.md` as a "Project guidelines" section.
 */
export function PRPromptEditDialog({
	workspaceId,
	open,
	onOpenChange,
	onOpenInEditor,
}: PRPromptEditDialogProps) {
	const { absolutePath, content, isLoading, save, isSaving } =
		useProjectPRPrompt(workspaceId);
	const [draft, setDraft] = useState("");
	const [dirty, setDirty] = useState(false);

	// Seed the textarea when the dialog opens — pick up any external edits
	// the user may have made between opens. Don't clobber an in-flight edit
	// if they reopen quickly.
	useEffect(() => {
		if (!open) {
			setDirty(false);
			return;
		}
		if (isLoading) return;
		setDraft(content ?? "");
		setDirty(false);
	}, [open, isLoading, content]);

	const canSave = dirty && !isSaving && !isLoading;
	const canOpenInEditor = Boolean(onOpenInEditor && absolutePath);

	const handleSave = async () => {
		if (!canSave) return;
		try {
			await save(draft);
			onOpenChange(false);
		} catch {
			// useProjectPRPrompt toasts the failure; keep the dialog open so
			// the user can retry.
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>PR instructions for this project</DialogTitle>
					<DialogDescription>
						Saved to{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
							{PR_PROMPT_RELATIVE_PATH}
						</code>{" "}
						in the project repo. Applied to both Create and Update. Leave empty
						to use the defaults.
					</DialogDescription>
				</DialogHeader>
				<Textarea
					value={draft}
					onChange={(e) => {
						setDraft(e.target.value);
						setDirty(true);
					}}
					placeholder={PLACEHOLDER}
					rows={12}
					disabled={isLoading}
					className="min-h-48 font-mono text-xs"
				/>
				<DialogFooter className="items-center sm:justify-between">
					{canOpenInEditor ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								if (absolutePath) onOpenInEditor?.(absolutePath);
								onOpenChange(false);
							}}
							className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
						>
							<LuExternalLink className="size-3" />
							Open in editor
						</Button>
					) : (
						<span />
					)}
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => onOpenChange(false)}
							disabled={isSaving}
						>
							Cancel
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={handleSave}
							disabled={!canSave}
						>
							{isSaving ? "Saving…" : "Save"}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
