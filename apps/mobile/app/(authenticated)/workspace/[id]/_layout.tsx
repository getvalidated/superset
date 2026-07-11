import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Stack, useLocalSearchParams } from "expo-router";
import { useWorkspaceHost } from "@/hooks/useWorkspaceHost";
import { GlassHeaderTitle } from "@/screens/(authenticated)/workspace/[id]/chat/components/GlassHeaderTitle";
import { WorkspaceMenuButton } from "@/screens/(authenticated)/workspace/[id]/components/WorkspaceMenuButton";

// Same glass treatment as the chat headers: transparent bar, floating back
// circle on iOS 26, title carrying its own glass pill.
const glassHeaderOptions = {
	headerShown: true,
	title: "",
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
				options={{
					...glassHeaderOptions,
					headerTitle: () => (
						<GlassHeaderTitle title={workspace?.name ?? null} />
					),
					headerRight: () => (
						<WorkspaceMenuButton workspace={workspace} host={host} />
					),
				}}
			/>
		</Stack>
	);
}
