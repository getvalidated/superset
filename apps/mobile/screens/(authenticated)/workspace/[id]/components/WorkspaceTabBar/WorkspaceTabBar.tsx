import type { TabItem } from "@superset/tab-bar";
import { TabBarView } from "@superset/tab-bar";
import { useLiveQuery } from "@tanstack/react-db";
import { useRouter } from "expo-router";
import { useTabTrigger } from "expo-router/ui";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCollections } from "@/screens/(authenticated)/providers/CollectionsProvider";

const TABS: TabItem[] = [
	{ name: "chat", icon: "bubble.left.and.bubble.right.fill", label: "Chat" },
	{ name: "changes", icon: "plus.forwardslash.minus", label: "Changes" },
	{ name: "__menu__", icon: "ellipsis", label: "More", isMenuTrigger: true },
];

const NAVIGABLE_TAB_NAMES = ["chat", "changes"];

const MENU_ACTIONS = [
	{ name: "home", icon: "house.fill", label: "Back to Home" },
];

const COLLAPSE_ANIMATION_MS = 400;

export function WorkspaceTabBar({ workspaceId }: { workspaceId: string }) {
	const router = useRouter();
	const collections = useCollections();
	const { switchTab, getTrigger } = useTabTrigger({ name: "chat" });
	const [isExpanded, setIsExpanded] = useState(false);
	const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const { data: workspaces } = useLiveQuery(
		(q) => q.from({ v2Workspaces: collections.v2Workspaces }),
		[collections],
	);
	const workspace = workspaces?.find((item) => item.id === workspaceId);

	const activeTab =
		NAVIGABLE_TAB_NAMES.find((name) => getTrigger(name)?.isFocused) ?? "chat";

	const handleExpandedChange = useCallback((expanded: boolean) => {
		if (expanded) {
			if (collapseTimer.current) {
				clearTimeout(collapseTimer.current);
				collapseTimer.current = null;
			}
			setIsExpanded(true);
		} else {
			collapseTimer.current = setTimeout(() => {
				setIsExpanded(false);
				collapseTimer.current = null;
			}, COLLAPSE_ANIMATION_MS);
		}
	}, []);

	const exitWorkspace = useCallback(() => {
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace("/(authenticated)/(tabs)/(home)");
	}, [router]);

	return (
		<View
			style={isExpanded ? styles.containerExpanded : styles.containerCollapsed}
			pointerEvents="box-none"
		>
			<TabBarView
				style={styles.tabBar}
				tabs={TABS}
				menuActions={MENU_ACTIONS}
				selectedTab={activeTab}
				organizationName={workspace?.name ?? "Workspace"}
				onTabSelect={(tab: string) => {
					switchTab(tab, { resetOnFocus: false });
				}}
				onMenuActionPress={(action: string) => {
					if (action === "home") {
						exitWorkspace();
					}
				}}
				onSettingsPress={exitWorkspace}
				onSearchPress={() => {
					// future
				}}
				onOrgPress={exitWorkspace}
				onExpandedChange={handleExpandedChange}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	containerCollapsed: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		height: 96,
	},
	containerExpanded: {
		position: "absolute",
		top: 0,
		bottom: 0,
		left: 0,
		right: 0,
	},
	tabBar: {
		flex: 1,
	},
});
