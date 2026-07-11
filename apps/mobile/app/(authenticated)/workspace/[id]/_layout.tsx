import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Stack, useLocalSearchParams } from "expo-router";
import { useWorkspaceHost } from "@/hooks/useWorkspaceHost";
import { WorkspaceToolbarMenu } from "@/screens/(authenticated)/workspace/[id]/components/WorkspaceToolbarMenu";

// Same glass treatment as the chat headers: transparent bar with the native
// centered title and a floating back circle on iOS 26.
const glassHeaderOptions = {
	headerShown: true,
	headerTransparent: true,
	headerBackButtonDisplayMode: "minimal",
	headerShadowVisible: false,
	...(isLiquidGlassAvailable()
		? {}
		: { headerBlurEffect: "systemUltraThinMaterial" as const }),
	headerStyle: { backgroundColor: "transparent" },
} as const;

export default function WorkspaceLayout() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const { workspace, host } = useWorkspaceHost(id ?? null);

	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Screen
				name="(tabs)"
				options={{ ...glassHeaderOptions, title: workspace?.name ?? "" }}
			>
				<WorkspaceToolbarMenu workspace={workspace} host={host} />
			</Stack.Screen>
		</Stack>
	);
}
