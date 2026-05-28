import type { RefObject } from "react";
import { useCallback, useEffect } from "react";
import { useHotkey } from "renderer/hotkeys";
import { getDiffSearchRoots } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/utils/diffRendererRoots";
import { useTextSearch } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/hooks";

interface UseDiffPaneSearchOptions {
	containerRef: RefObject<HTMLDivElement | null>;
	/** Whether the diff pane is the active pane (drives hotkey + auto-close). */
	isActive: boolean;
}

interface UseDiffPaneSearchReturn {
	isSearchOpen: boolean;
	query: string;
	caseSensitive: boolean;
	matchCount: number;
	activeMatchIndex: number;
	setQuery: (query: string) => void;
	setCaseSensitive: (caseSensitive: boolean) => void;
	findNext: () => void;
	findPrevious: () => void;
	closeSearch: () => void;
}

/**
 * Cmd+F text search for the v2 changes (diff) pane. Searches the rendered diff
 * content across each file's `@pierre/diffs` shadow root via the shared
 * DOM-highlight `useTextSearch` hook. Because the underlying CodeView is
 * virtualized, matches are scoped to currently rendered/expanded lines.
 */
export function useDiffPaneSearch({
	containerRef,
	isActive,
}: UseDiffPaneSearchOptions): UseDiffPaneSearchReturn {
	const getSearchRoots = useCallback(
		(container: HTMLDivElement) => getDiffSearchRoots(container),
		[],
	);

	const textSearch = useTextSearch({
		containerRef,
		getSearchRoots,
		highlightPrefix: "diff-pane-search",
	});

	useEffect(() => {
		if (!isActive && textSearch.isSearchOpen) {
			textSearch.closeSearch();
		}
	}, [isActive, textSearch.closeSearch, textSearch.isSearchOpen]);

	useHotkey(
		"FIND_IN_DIFF",
		() => {
			if (textSearch.isSearchOpen) {
				textSearch.closeSearch();
				return;
			}
			textSearch.setIsSearchOpen(true);
		},
		{ enabled: isActive, preventDefault: true },
	);

	return {
		isSearchOpen: textSearch.isSearchOpen,
		query: textSearch.query,
		caseSensitive: textSearch.caseSensitive,
		matchCount: textSearch.matchCount,
		activeMatchIndex: textSearch.activeMatchIndex,
		setQuery: textSearch.setQuery,
		setCaseSensitive: textSearch.setCaseSensitive,
		findNext: textSearch.findNext,
		findPrevious: textSearch.findPrevious,
		closeSearch: textSearch.closeSearch,
	};
}
