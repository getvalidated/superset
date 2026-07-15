import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useMemo } from "react";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import {
	canvasWindowIds,
	getGlobalCanvasStore,
	openCanvasWindow,
} from "../../../canvas";
import type {
	CommentPaneData,
	DiffFocusSide,
	DiffPaneData,
	FilePaneData,
} from "../../types";

/**
 * Canvas-mode counterparts of the tabbed-layout pane openers. Sidebar and
 * quick-open picks route here while the canvas is showing, so they open (or
 * focus) free-floating windows instead of silently mutating the hidden tab
 * layout.
 */
export function useCanvasWindowOpeners({
	workspaceId,
}: {
	workspaceId: string;
}): {
	openFileOnCanvas: (filePath: string, openInNewTab?: boolean) => void;
	openDiffOnCanvas: (
		filePath: string,
		openInNewTab?: boolean,
		line?: number,
		side?: DiffFocusSide,
		changeKey?: string,
	) => void;
	openCommentOnCanvas: (comment: CommentPaneData) => void;
} {
	const { activeOrganizationId } = useLocalHostService();
	const store = useMemo(
		() => getGlobalCanvasStore(activeOrganizationId ?? "default"),
		[activeOrganizationId],
	);
	const workspaceQuery = workspaceTrpc.workspace.get.useQuery({
		id: workspaceId,
	});
	const worktreePath = workspaceQuery.data?.worktreePath ?? "";

	// "Open in new tab" has no canvas meaning — every open is its own window,
	// deduped by id, so the flag is accepted for signature parity and ignored.
	const openFileOnCanvas = useCallback(
		(filePath: string, _openInNewTab?: boolean) => {
			const absoluteFilePath = worktreePath
				? toAbsoluteWorkspacePath(worktreePath, filePath)
				: filePath;
			openCanvasWindow(store, {
				id: canvasWindowIds.file(workspaceId, absoluteFilePath),
				kind: "file",
				workspaceId,
				data: {
					filePath: absoluteFilePath,
					mode: "editor",
				} satisfies FilePaneData,
				// Re-picking an open file focuses it without clobbering view
				// state (dirty edits, chosen view).
				onExisting: "keep-data",
			});
		},
		[store, workspaceId, worktreePath],
	);

	const openDiffOnCanvas = useCallback(
		(
			filePath: string,
			_openInNewTab?: boolean,
			line?: number,
			side?: DiffFocusSide,
			changeKey?: string,
		) => {
			const id = canvasWindowIds.diff(workspaceId);
			// Bump tick on every request so the scroll effect re-fires on repeat
			// clicks; clear when no line is given so reused windows don't jump
			// to a stale focus. Mirrors useWorkspacePaneOpeners.openDiffPane.
			const focusFields =
				line != null
					? { focusLine: line, focusSide: side, focusTick: Date.now() }
					: {
							focusLine: undefined,
							focusSide: undefined,
							focusTick: undefined,
						};
			const prev = store.getState().windows[id]?.data as
				| DiffPaneData
				| undefined;
			const data: DiffPaneData = prev
				? {
						...prev,
						path: filePath,
						changeKey,
						// Only the navigated file's key can be pruned; without a
						// change key we can't identify it, so leave the set intact.
						collapsedFiles: changeKey
							? (prev.collapsedFiles ?? []).filter((key) => key !== changeKey)
							: (prev.collapsedFiles ?? []),
						...focusFields,
					}
				: { path: filePath, changeKey, collapsedFiles: [], ...focusFields };
			openCanvasWindow(store, { id, kind: "diff", workspaceId, data });
		},
		[store, workspaceId],
	);

	const openCommentOnCanvas = useCallback(
		(comment: CommentPaneData) => {
			openCanvasWindow(store, {
				id: canvasWindowIds.comment(workspaceId),
				kind: "comment",
				workspaceId,
				data: comment,
			});
		},
		[store, workspaceId],
	);

	return { openFileOnCanvas, openDiffOnCanvas, openCommentOnCanvas };
}
