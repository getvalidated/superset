import type {
	FileTreeRowDecoration,
	FileTreeRowDecorationContext,
	ContextMenuItem as PierreContextMenuItem,
	ContextMenuOpenContext as PierreContextMenuOpenContext,
} from "@pierre/trees";
import {
	FileTree as PierreFileTree,
	useFileTree as usePierreFileTree,
} from "@pierre/trees/react";
import { memo, useEffect, useMemo, useRef } from "react";
import {
	ShadowClickHint,
	usePierreRowClickPolicy,
	useSidebarFilePolicy,
} from "renderer/lib/clickPolicy";
import type { FileStatus } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/StatusIndicator";
import { PierreRowContextMenu } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/PierreRowContextMenu";
import type { ChangesetFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useChangeset";
import { FileRowContextMenuItems } from "./components/FileRowContextMenuItems";

const TREE_STYLE: React.CSSProperties = {
	"--trees-row-height-override": "24px",
	"--trees-level-gap-override": "8px",
	"--trees-padding-inline-override": "0",
	"--trees-item-margin-x-override": "0",
	"--trees-item-padding-x-override": "calc(var(--spacing) * 3)",
	"--trees-item-row-gap-override": "calc(var(--spacing) * 1.5)",
	"--trees-icon-width-override": "calc(var(--spacing) * 3.5)",
	"--trees-border-radius-override": "0",

	"--trees-bg-override": "var(--background)",
	"--trees-fg-override": "var(--foreground)",
	"--trees-fg-muted-override": "var(--muted-foreground)",
	"--trees-bg-muted-override":
		"color-mix(in oklab, var(--accent) 50%, transparent)",
	"--trees-accent-override": "var(--accent)",
	"--trees-border-color-override": "var(--border)",

	"--trees-selected-bg-override": "var(--accent)",
	"--trees-selected-fg-override": "var(--accent-foreground)",
	"--trees-selected-focused-border-color-override": "var(--ring)",

	"--trees-focus-ring-color-override": "var(--ring)",
	"--trees-focus-ring-offset-override": "0px",

	"--trees-status-added-override": "oklch(0.627 0.194 149.214)",
	"--trees-status-untracked-override": "oklch(0.627 0.194 149.214)",
	"--trees-status-modified-override": "oklch(0.681 0.162 75.834)",
	"--trees-status-deleted-override": "oklch(0.577 0.245 27.325)",
	"--trees-status-renamed-override": "oklch(0.6 0.118 244.557)",
	"--trees-status-ignored-override": "var(--muted-foreground)",

	"--trees-font-size-override": "var(--text-xs)",
} as React.CSSProperties;

const PIERRE_GIT_STATUS: Record<
	FileStatus,
	"added" | "deleted" | "modified" | "renamed" | "untracked"
> = {
	added: "added",
	changed: "modified",
	copied: "added",
	deleted: "deleted",
	modified: "modified",
	renamed: "renamed",
	untracked: "untracked",
};

interface ChangesTreeViewProps {
	/** Files for a single section — caller has already pre-grouped by `source.kind`. */
	files: ChangesetFile[];
	/** Section the files came from; used to scope context-menu Discard. */
	sectionKind: "unstaged" | "staged" | "against-base" | "commit";
	workspaceId: string;
	worktreePath?: string;
	onSelectFile?: (path: string, openInNewTab?: boolean) => void;
	onOpenFile?: (absolutePath: string, openInNewTab?: boolean) => void;
	onOpenInEditor?: (path: string) => void;
}

/**
 * Tree view of a single changes section, powered by `@pierre/trees`. Pierre
 * builds the directory hierarchy from the flat path list, handles
 * virtualization + status tints + icons, and we layer on top:
 *
 *  - `renderRowDecoration` for `+N/−N` and the rename arrow
 *  - `renderContextMenu` for the same actions as `FileRow` (Open Diff, Open
 *    in New Tab, Open File, Open in Editor, Discard on unstaged)
 *  - `usePierreRowClickPolicy` for settings-driven click routing
 *
 * Selection sync (an external `selectedFilePath` echoed back to Pierre via
 * `model.focusPath`) is intentionally not plumbed yet — clicks still fire
 * `onSelectFile`, and the diff pane stays the source of truth.
 */
export const ChangesTreeView = memo(function ChangesTreeView({
	files,
	sectionKind,
	workspaceId,
	worktreePath,
	onSelectFile,
	onOpenFile,
	onOpenInEditor,
}: ChangesTreeViewProps) {
	const paths = useMemo(() => files.map((f) => f.path), [files]);
	const fileByPath = useMemo(() => {
		const map = new Map<string, ChangesetFile>();
		for (const file of files) map.set(file.path, file);
		return map;
	}, [files]);

	const initialGitStatusEntriesRef = useRef(buildPierreGitStatus(files));

	// Callbacks routed through a ref so Pierre's stable handler closures
	// (resolved once at `useFileTree` time) always see the latest props.
	const handlersRef = useRef({
		onSelect(_path: string) {},
		renderRowDecoration(
			_ctx: FileTreeRowDecorationContext,
		): FileTreeRowDecoration | null {
			return null;
		},
	});

	const { model } = usePierreFileTree({
		paths,
		initialExpansion: "open",
		search: false,
		gitStatus: initialGitStatusEntriesRef.current,
		icons: { set: "complete", colored: true },
		itemHeight: 24,
		overscan: 20,
		stickyFolders: true,
		onSelectionChange: (selected) => {
			const last = selected[selected.length - 1];
			if (!last || last.endsWith("/")) return;
			handlersRef.current.onSelect(last);
		},
		renderRowDecoration: (ctx) => handlersRef.current.renderRowDecoration(ctx),
	});

	// Keep Pierre's path set in sync as files churn (stage/unstage, new edits).
	useEffect(() => {
		model.resetPaths(paths);
	}, [model, paths]);

	useEffect(() => {
		model.setGitStatus(buildPierreGitStatus(files));
	}, [model, files]);

	handlersRef.current.onSelect = (treePath) => {
		onSelectFile?.(treePath, false);
	};
	// Pierre's row decoration accepts text or icon, not arbitrary JSX. The
	// status indicator is already painted by `setGitStatus` (row tint + icon),
	// so we only contribute the `+N/−N` summary as text. Color distinction
	// between additions and deletions is dropped here — trade-off for Pierre's
	// shadow-DOM ownership of the row.
	handlersRef.current.renderRowDecoration = (ctx) => {
		if (ctx.item.kind === "directory") return null;
		const file = fileByPath.get(ctx.item.path);
		if (!file) return null;
		const text = formatDiffStats(file.additions, file.deletions);
		return text ? { text } : null;
	};

	const filePolicy = useSidebarFilePolicy();
	const { onClickCapture, findFileRow } = usePierreRowClickPolicy({
		filePolicy,
		onSelectFile: (rel, openInNewTab) => onSelectFile?.(rel, openInNewTab),
		openInExternalEditor: (rel) => onOpenInEditor?.(rel),
	});

	const renderContextMenu = (
		item: PierreContextMenuItem,
		ctx: PierreContextMenuOpenContext,
	) => {
		if (item.kind === "directory") return null;
		const file = fileByPath.get(item.path);
		if (!file) return null;
		return (
			<PierreRowContextMenu
				anchorRect={ctx.anchorRect}
				onClose={ctx.close}
				data-file-tree-context-menu-root="true"
			>
				<FileRowContextMenuItems
					file={file}
					workspaceId={workspaceId}
					worktreePath={worktreePath}
					sectionKind={sectionKind}
					onSelectFile={onSelectFile}
					onOpenFile={onOpenFile}
					onOpenInEditor={onOpenInEditor}
				/>
			</PierreRowContextMenu>
		);
	};

	return (
		<div onClickCapture={onClickCapture}>
			<ShadowClickHint hint={filePolicy.hint} findRow={findFileRow}>
				<PierreFileTree
					model={model}
					style={TREE_STYLE}
					renderContextMenu={renderContextMenu}
				/>
			</ShadowClickHint>
		</div>
	);
});

function buildPierreGitStatus(files: ChangesetFile[]): {
	path: string;
	status: "added" | "deleted" | "modified" | "renamed" | "untracked";
}[] {
	return files.map((file) => ({
		path: file.path,
		status: PIERRE_GIT_STATUS[file.status],
	}));
}

function formatDiffStats(additions: number, deletions: number): string {
	if (additions === 0 && deletions === 0) return "";
	if (additions === 0) return `−${deletions}`;
	if (deletions === 0) return `+${additions}`;
	return `+${additions} −${deletions}`;
}
