import type { FileTree } from "@pierre/trees";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useEffect, useState } from "react";
import {
	asDirectoryHandle,
	basename,
	parentRel,
	stripTrailingSlash,
	toAbs,
} from "../../utils/treePath";
import type { FilesTabBridge } from "../useFilesTabBridge";

interface UseFilesTabDropOptions {
	model: FileTree;
	bridge: FilesTabBridge;
	/** Workspace worktree root (absolute). */
	rootPath: string;
	workspaceId: string;
}

export interface FilesTabDropTarget {
	/** Relative directory the dropped files copy into. "" = worktree root. */
	dirRel: string;
	/** Human label for the overlay — folder basename, or "workspace root". */
	label: string;
}

export interface FilesTabDrop {
	/** Non-null while an external file drag hovers the tree. */
	dropTarget: FilesTabDropTarget | null;
	onDragOver(e: React.DragEvent<HTMLDivElement>): void;
	onDragLeave(e: React.DragEvent<HTMLDivElement>): void;
	onDrop(e: React.DragEvent<HTMLDivElement>): void;
}

/** True when the drag carries OS files (vs. an internal/text drag). */
function dragHasFiles(e: React.DragEvent): boolean {
	return Array.from(e.dataTransfer.types).includes("Files");
}

/**
 * Resolve which directory a drag is over by walking `composedPath()` for the
 * nearest row's `data-item-path` (stamped by `@pierre/trees`, lives in an open
 * shadow root). Directory rows carry a trailing slash → drop into that folder;
 * file rows → drop into their parent; nothing under the cursor → worktree root.
 */
function resolveDropDirRel(e: React.DragEvent): string {
	for (const node of e.nativeEvent.composedPath()) {
		if (!(node instanceof HTMLElement)) continue;
		const itemPath = node.getAttribute("data-item-path");
		if (itemPath) {
			return itemPath.endsWith("/")
				? stripTrailingSlash(itemPath)
				: parentRel(itemPath);
		}
	}
	return "";
}

/** Basename of a native OS path (handles both `/` and `\` separators). */
function nativeBasename(absPath: string): string {
	const segments = absPath.split(/[\\/]/);
	return segments[segments.length - 1] ?? absPath;
}

function dirLabel(dirRel: string): string {
	return dirRel === "" ? "workspace root" : basename(dirRel);
}

/**
 * Drag-and-drop file upload for the v2 Files tab. Dropping OS files onto a
 * folder row copies them into that folder (onto a file row → its parent, onto
 * empty space → the worktree root) via `filesystem.copyPath`. The new entries
 * surface automatically through the bridge's `fs:events` reconciliation; we
 * also expand + fetch the destination so they appear without a manual refresh.
 */
export function useFilesTabDrop({
	model,
	bridge,
	rootPath,
	workspaceId,
}: UseFilesTabDropOptions): FilesTabDrop {
	const copyPath = workspaceTrpc.filesystem.copyPath.useMutation();
	const [dropTarget, setDropTarget] = useState<FilesTabDropTarget | null>(null);

	// Clear the overlay if the drag ends outside our handlers (released over
	// another window, dropped elsewhere, or canceled with Esc).
	useEffect(() => {
		const clear = () => setDropTarget(null);
		window.addEventListener("dragend", clear);
		window.addEventListener("drop", clear);
		return () => {
			window.removeEventListener("dragend", clear);
			window.removeEventListener("drop", clear);
		};
	}, []);

	const uploadFiles = useCallback(
		async (dirRel: string, sources: string[]): Promise<void> => {
			const destDirAbs = toAbs(rootPath, dirRel);
			const versionToken = bridge.getVersion();

			const results = await Promise.allSettled(
				sources.map((sourceAbsolutePath) =>
					copyPath.mutateAsync({
						workspaceId,
						sourceAbsolutePath,
						destinationAbsolutePath: `${destDirAbs}/${nativeBasename(sourceAbsolutePath)}`,
					}),
				),
			);

			// User switched workspaces mid-copy — don't toast/expand against the
			// new tree.
			if (!bridge.isCurrent(versionToken)) return;

			const copied = results.filter((r) => r.status === "fulfilled").length;
			const failed = results.length - copied;

			if (copied > 0) {
				const where = dirLabel(dirRel);
				toast.success(
					copied === 1
						? `Added 1 file to ${where}`
						: `Added ${copied} files to ${where}`,
				);
				// Surface the new entries immediately. fs:events also reconciles,
				// but expanding + fetching avoids waiting on the watcher and shows
				// results inside a collapsed destination folder.
				if (dirRel) {
					const handle = asDirectoryHandle(model.getItem(`${dirRel}/`));
					if (handle && !handle.isExpanded()) handle.expand();
				}
				void bridge.fetchDir(dirRel);
			}
			if (failed > 0) {
				toast.error(
					failed === 1
						? "Failed to add 1 file"
						: `Failed to add ${failed} files`,
				);
			}
		},
		[model, bridge, copyPath, rootPath, workspaceId],
	);

	const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
		const dirRel = resolveDropDirRel(e);
		setDropTarget({ dirRel, label: dirLabel(dirRel) });
	}, []);

	const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		// Ignore leaves into child rows — only clear when the cursor exits the
		// tree's bounds.
		const rect = e.currentTarget.getBoundingClientRect();
		const { clientX, clientY } = e;
		if (
			clientX < rect.left ||
			clientX > rect.right ||
			clientY < rect.top ||
			clientY > rect.bottom
		) {
			setDropTarget(null);
		}
	}, []);

	const onDrop = useCallback(
		(e: React.DragEvent<HTMLDivElement>) => {
			if (!dragHasFiles(e)) return;
			e.preventDefault();
			e.stopPropagation();
			setDropTarget(null);
			if (!rootPath || !workspaceId) return;

			// Read everything off the event synchronously — composedPath() and
			// getPathForFile are only valid during dispatch, before any await.
			const dirRel = resolveDropDirRel(e);
			const sources: string[] = [];
			for (const file of Array.from(e.dataTransfer.files)) {
				try {
					const path = window.webUtils.getPathForFile(file);
					if (path) sources.push(path);
				} catch {
					// Skip entries we can't resolve to a filesystem path.
				}
			}

			if (sources.length === 0) {
				toast.error("Could not read the dropped files");
				return;
			}

			void uploadFiles(dirRel, sources);
		},
		[rootPath, workspaceId, uploadFiles],
	);

	return { dropTarget, onDragOver, onDragLeave, onDrop };
}
