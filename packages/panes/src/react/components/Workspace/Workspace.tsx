import { cn } from "@superset/ui/utils";
import { useCallback, useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { Pane } from "../../../types";
import type { WorkspaceProps } from "../../types";
import { Tab } from "./components/Tab";
import { TabBar } from "./components/TabBar";
import { useWorkspaceInteractionState } from "./hooks/useWorkspaceInteractionState";

export function Workspace<TData>({
	store,
	registry,
	className,
	renderTabAccessory,
	renderTabIcon,
	renderEmptyState,
	renderAddTabMenu,
	renderTabBarTrailing,
	renderBelowTabBar,
	onBeforeCloseTab,
	onAfterCloseTab,
	onInteractionStateChange,
	paneActions,
	contextMenuActions,
}: WorkspaceProps<TData>) {
	const tabs = useStore(store, (s) => s.tabs);
	const activeTabId = useStore(store, (s) => s.activeTabId);
	const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
	const { onSplitResizeDragging } = useWorkspaceInteractionState({
		onInteractionStateChange,
	});

	const previousPanesRef = useRef<Map<string, Pane<TData>>>(new Map());
	useEffect(() => {
		const current = new Map<string, Pane<TData>>();
		for (const tab of tabs) {
			for (const pane of Object.values(tab.panes)) {
				current.set(pane.id, pane);
			}
		}
		for (const [prevId, prevPane] of previousPanesRef.current) {
			if (!current.has(prevId)) {
				registry[prevPane.kind]?.onAfterClose?.(prevPane);
			}
		}
		previousPanesRef.current = current;
	}, [tabs, registry]);

	const closeTab = useCallback(
		async (tabId: string) => {
			const tab = store.getState().getTab(tabId);
			if (!tab) return;
			if (onBeforeCloseTab) {
				const allowed = await onBeforeCloseTab(tab);
				if (!allowed) return;
			}
			// Re-check after the await: the tab may have been removed concurrently.
			if (!store.getState().getTab(tabId)) return;
			store.getState().removeTab(tabId);
			try {
				onAfterCloseTab?.(tab);
			} catch (err) {
				console.error("onAfterCloseTab threw", err);
			}
		},
		[onAfterCloseTab, onBeforeCloseTab, store],
	);

	const selectTab = useCallback(
		(tabId: string) => store.getState().setActiveTab(tabId),
		[store],
	);
	const closeOtherTabs = useCallback(
		async (tabId: string) => {
			for (const tab of store.getState().tabs) {
				if (tab.id !== tabId) await closeTab(tab.id);
			}
		},
		[closeTab, store],
	);
	const closeAllTabs = useCallback(async () => {
		for (const tab of store.getState().tabs) {
			await closeTab(tab.id);
		}
	}, [closeTab, store]);
	const renameTab = useCallback(
		(tabId: string, title: string | undefined) =>
			store.getState().setTabTitleOverride({ tabId, titleOverride: title }),
		[store],
	);
	const reorderTab = useCallback(
		(tabId: string, toIndex: number) =>
			store.getState().reorderTab({ tabId, toIndex }),
		[store],
	);
	const movePaneToNewTab = useCallback(
		(paneId: string, toIndex: number) =>
			store.getState().movePaneToNewTab({ paneId, toIndex }),
		[store],
	);

	return (
		<div
			className={cn(
				"flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground",
				className,
			)}
		>
			<TabBar
				tabs={tabs}
				store={store}
				registry={registry}
				activeTabId={activeTabId}
				onSelectTab={selectTab}
				onCloseTab={closeTab}
				onCloseOtherTabs={closeOtherTabs}
				onCloseAllTabs={closeAllTabs}
				onRenameTab={renameTab}
				onReorderTab={reorderTab}
				onMovePaneToNewTab={movePaneToNewTab}
				renderTabIcon={renderTabIcon}
				renderAddTabMenu={renderAddTabMenu}
				renderTabBarTrailing={renderTabBarTrailing}
				renderTabAccessory={renderTabAccessory}
			/>
			{renderBelowTabBar?.()}
			{activeTab ? (
				<Tab
					store={store}
					tab={activeTab}
					registry={registry}
					paneActions={paneActions}
					contextMenuActions={contextMenuActions}
					onSplitResizeDragging={onSplitResizeDragging}
				/>
			) : (
				<div className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					{renderEmptyState?.() ?? "No tabs open"}
				</div>
			)}
		</div>
	);
}
