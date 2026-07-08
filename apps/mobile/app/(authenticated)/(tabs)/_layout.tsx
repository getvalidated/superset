import { NativeTabs } from "expo-router/unstable-native-tabs";
import { THEME } from "@/lib/theme";

export default function TabsLayout() {
	return (
		<NativeTabs
			tintColor={THEME.dark.foreground}
			iconColor={THEME.dark.mutedForeground}
			blurEffect="systemThickMaterialDark"
			minimizeBehavior="never"
		>
			<NativeTabs.Trigger name="(home)">
				<NativeTabs.Trigger.Icon
					sf={{ default: "house", selected: "house.fill" }}
				/>
				<NativeTabs.Trigger.Label hidden>Home</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="(tasks)">
				<NativeTabs.Trigger.Icon
					sf={{ default: "list.clipboard", selected: "list.clipboard.fill" }}
				/>
				<NativeTabs.Trigger.Label hidden>Tasks</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="(search)" role="search">
				<NativeTabs.Trigger.Icon sf="magnifyingglass" />
				<NativeTabs.Trigger.Label hidden>Search</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="(more)">
				<NativeTabs.Trigger.Icon sf="ellipsis" />
				<NativeTabs.Trigger.Label hidden>More</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
