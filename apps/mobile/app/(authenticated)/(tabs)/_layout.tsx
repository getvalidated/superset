import { TabList, TabSlot, Tabs, TabTrigger } from "expo-router/ui";
import { AuthenticatedTabBar } from "@/screens/(authenticated)/components/AuthenticatedTabBar";

export default function TabsLayout() {
	return (
		<Tabs>
			<TabSlot style={{ flex: 1 }} />
			<TabList style={{ display: "none" }}>
				<TabTrigger name="(home)" href="/(authenticated)/(tabs)/(home)" />
				<TabTrigger name="(tasks)" href="/(authenticated)/(tabs)/(tasks)" />
				<TabTrigger name="(more)" href="/(authenticated)/(tabs)/(more)" />
			</TabList>
			<AuthenticatedTabBar />
		</Tabs>
	);
}
