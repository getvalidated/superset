import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import {
	ExternalLink,
	FileText,
	GitCompare,
	SquarePlus,
	Trash2,
	Undo2,
} from "lucide-react";
import { useState } from "react";
import { modifierLabel, useSidebarFilePolicy } from "renderer/lib/clickPolicy";
import { DiscardConfirmDialog } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/DiscardConfirmDialog";
import { PathActionsMenuItems } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/PathActionsMenuItems";
import type { ChangesetFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useChangeset";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";

interface FileRowContextMenuItemsProps {
	file: ChangesetFile;
	workspaceId: string;
	worktreePath?: string;
	sectionKind: "unstaged" | "staged" | "against-base" | "commit";
	onSelectFile?: (path: string, openInNewTab?: boolean) => void;
	onOpenFile?: (absolutePath: string, openInNewTab?: boolean) => void;
	onOpenInEditor?: (path: string) => void;
}

/**
 * Right-click menu items for a Pierre row in the changes tree. Mirrors the
 * `FileRow` right-click menu so users get the same vocabulary regardless of
 * view mode.
 */
export function FileRowContextMenuItems({
	file,
	workspaceId,
	worktreePath,
	sectionKind,
	onSelectFile,
	onOpenFile,
	onOpenInEditor,
}: FileRowContextMenuItemsProps) {
	const absolutePath = worktreePath
		? toAbsoluteWorkspacePath(worktreePath, file.path)
		: undefined;
	const canDiscard = sectionKind === "unstaged";
	const isDeleteAction = file.status === "untracked" || file.status === "added";
	const basename = file.path.split("/").pop() ?? file.path;

	const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
	const utils = workspaceTrpc.useUtils();
	const discardMutation = workspaceTrpc.git.discardChanges.useMutation({
		onSuccess: () => {
			void utils.git.getStatus.invalidate({ workspaceId });
			void utils.git.getDiff.invalidate({ workspaceId });
		},
		onError: (err) => {
			toast.error("Couldn't discard changes", { description: err.message });
		},
	});

	const policy = useSidebarFilePolicy();
	const newTabTier = policy.tierForAction("newTab");
	const externalTier = policy.tierForAction("external");

	return (
		<>
			<DropdownMenuItem onSelect={() => onSelectFile?.(file.path)}>
				<GitCompare />
				Open Diff
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => onSelectFile?.(file.path, true)}>
				<SquarePlus />
				Open Diff in New Tab
				{newTabTier && (
					<DropdownMenuShortcut>
						{modifierLabel(newTabTier)}
					</DropdownMenuShortcut>
				)}
			</DropdownMenuItem>
			<DropdownMenuItem
				onSelect={() => absolutePath && onOpenFile?.(absolutePath)}
				disabled={!onOpenFile || !absolutePath}
			>
				<FileText />
				Open File
			</DropdownMenuItem>
			<DropdownMenuItem
				onSelect={() => absolutePath && onOpenFile?.(absolutePath, true)}
				disabled={!onOpenFile || !absolutePath}
			>
				<SquarePlus />
				Open File in New Tab
			</DropdownMenuItem>
			<DropdownMenuItem
				onSelect={() => onOpenInEditor?.(file.path)}
				disabled={!onOpenInEditor}
			>
				<ExternalLink />
				Open in Editor
				{externalTier && (
					<DropdownMenuShortcut>
						{modifierLabel(externalTier)}
					</DropdownMenuShortcut>
				)}
			</DropdownMenuItem>
			{absolutePath && (
				<>
					<DropdownMenuSeparator />
					<PathActionsMenuItems
						absolutePath={absolutePath}
						relativePath={file.path}
					/>
				</>
			)}
			{canDiscard && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => setShowDiscardConfirm(true)}
					>
						{isDeleteAction ? <Trash2 /> : <Undo2 />}
						{isDeleteAction ? "Delete" : "Discard changes"}
					</DropdownMenuItem>
				</>
			)}
			<DiscardConfirmDialog
				open={showDiscardConfirm}
				onOpenChange={setShowDiscardConfirm}
				title={
					isDeleteAction
						? `Delete "${basename}"?`
						: `Discard changes to "${basename}"?`
				}
				description={
					isDeleteAction
						? "This will permanently delete this file. This action cannot be undone."
						: "This will revert all changes to this file. This action cannot be undone."
				}
				confirmLabel={isDeleteAction ? "Delete" : "Discard"}
				onConfirm={() => {
					setShowDiscardConfirm(false);
					discardMutation.mutate({ workspaceId, filePath: file.path });
				}}
			/>
		</>
	);
}
