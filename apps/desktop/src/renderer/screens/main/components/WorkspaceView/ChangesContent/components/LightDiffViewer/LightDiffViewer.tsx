import { MultiFileDiff } from "@pierre/diffs/react";
import { cn } from "@superset/ui/utils";
import type { CSSProperties } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	getDiffsTheme,
	getDiffViewerStyle,
} from "renderer/screens/main/components/WorkspaceView/utils/code-theme";
import { useResolvedTheme } from "renderer/stores/theme";
import type { DiffViewMode, FileContents } from "shared/changes-types";
import { isDiffTooLarge } from "shared/diff-size";

interface LightDiffViewerProps {
	contents: FileContents;
	viewMode: DiffViewMode;
	hideUnchangedRegions?: boolean;
	filePath: string;
	className?: string;
	style?: CSSProperties;
}

export function LightDiffViewer({
	contents,
	viewMode,
	hideUnchangedRegions,
	filePath,
	className,
	style,
}: LightDiffViewerProps) {
	const activeTheme = useResolvedTheme();

	// `MultiFileDiff` is not virtualized: it parses and lays out every line
	// synchronously on the main thread. For very large files (lockfiles,
	// minified bundles, generated snapshots) that freezes the app (#5462), so
	// short-circuit to a placeholder instead of rendering the diff.
	const tooLarge = isDiffTooLarge(contents.original, contents.modified);

	const { data: fontSettings } = electronTrpc.settings.getFontSettings.useQuery(
		undefined,
		{
			staleTime: 30_000,
		},
	);
	const shikiTheme = getDiffsTheme(activeTheme);
	const parsedEditorFontSize =
		typeof fontSettings?.editorFontSize === "number"
			? fontSettings.editorFontSize
			: typeof fontSettings?.editorFontSize === "string"
				? Number.parseFloat(fontSettings.editorFontSize)
				: Number.NaN;
	const diffStyle = getDiffViewerStyle(activeTheme, {
		fontFamily: fontSettings?.editorFontFamily ?? undefined,
		fontSize: Number.isFinite(parsedEditorFontSize)
			? parsedEditorFontSize
			: undefined,
	});

	if (tooLarge) {
		return (
			<div
				className={cn(
					"flex flex-col items-center justify-center gap-1 bg-background px-4 py-8 text-center text-sm text-muted-foreground",
					className,
				)}
				style={style}
			>
				<span className="cursor-text select-text">
					File too large to display
				</span>
				<span className="max-w-md text-xs">
					This diff is too big to render without freezing the app. Use the file
					header to open it outside the diff viewer.
				</span>
			</div>
		);
	}

	return (
		<MultiFileDiff
			oldFile={{ name: filePath, contents: contents.original }}
			newFile={{ name: filePath, contents: contents.modified }}
			className={cn(className)}
			style={{
				...diffStyle,
				...style,
			}}
			options={{
				diffStyle: viewMode === "side-by-side" ? "split" : "unified",
				expandUnchanged: !hideUnchangedRegions,
				theme: shikiTheme,
				themeType: activeTheme.type,
				overflow: "wrap",
				disableFileHeader: true,
				unsafeCSS: `
					* {
						user-select: text;
						-webkit-user-select: text;
					}
				`,
			}}
		/>
	);
}
