import { useLocalSearchParams } from "expo-router";
import { TabList, TabSlot, Tabs, TabTrigger } from "expo-router/ui";
import { WorkspaceTabBar } from "@/screens/(authenticated)/workspace/[id]/components/WorkspaceTabBar";

export default function WorkspaceLayout() {
	const { id } = useLocalSearchParams<{ id: string }>();

	return (
		<Tabs>
			<TabSlot style={{ flex: 1 }} />
			<TabList style={{ display: "none" }}>
				<TabTrigger
					name="chat"
					href={`/(authenticated)/workspace/${id}/chat`}
				/>
				<TabTrigger
					name="changes"
					href={`/(authenticated)/workspace/${id}/changes`}
				/>
			</TabList>
			<WorkspaceTabBar workspaceId={id} />
		</Tabs>
	);
}
