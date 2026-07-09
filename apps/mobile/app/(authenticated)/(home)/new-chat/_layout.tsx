import { Stack } from "expo-router";
import { SheetCloseButton } from "@/screens/(authenticated)/(home)/components/SheetCloseButton";

export default function NewChatLayout() {
	return (
		<Stack
			screenOptions={{
				headerBackButtonDisplayMode: "minimal",
				headerShadowVisible: false,
				headerLeft: () => <SheetCloseButton />,
			}}
		>
			<Stack.Screen name="branch" options={{ title: "Branch" }} />
			<Stack.Screen name="model" options={{ title: "Model" }} />
			<Stack.Screen name="project" options={{ title: "Project" }} />
		</Stack>
	);
}
