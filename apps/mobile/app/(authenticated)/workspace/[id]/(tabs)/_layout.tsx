import { NativeTabs } from "expo-router/unstable-native-tabs";
import { THEME } from "@/lib/theme";

export default function WorkspaceTabsLayout() {
	return (
		<NativeTabs tintColor={THEME.dark.foreground}>
			<NativeTabs.Trigger name="index">
				<NativeTabs.Trigger.Icon sf="bubble.left" />
				<NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="diff">
				<NativeTabs.Trigger.Icon sf="plus.forwardslash.minus" />
				<NativeTabs.Trigger.Label>Diff</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
