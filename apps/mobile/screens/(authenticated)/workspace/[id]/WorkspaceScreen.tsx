import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
// Imported from expo-router's vendored copy on purpose: this reads the SAME
// HeaderHeightContext that expo-router's Stack populates. Declaring
// `@react-navigation/elements` as our own dep would pull a second copy with a
// different context instance and always return 0.
import { useHeaderHeight } from "expo-router/build/react-navigation/elements/Header/useHeaderHeight";
import { GitBranch } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useWorkspaceHost } from "@/hooks/useWorkspaceHost";
import { SessionRow } from "@/screens/(authenticated)/(home)/home/components/SessionRow";
import { useHostAcpSessions } from "@/screens/(authenticated)/(home)/home/hooks/useHostAcpSessions";
import { buildSessionRows } from "@/screens/(authenticated)/(home)/home/utils/sessionRows";
import { DiffPlaceholder } from "./components/DiffPlaceholder";
import {
	type WorkspaceTab,
	WorkspaceTabBar,
} from "./components/WorkspaceTabBar";

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

export function WorkspaceScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const router = useRouter();
	const [tab, setTab] = useState<WorkspaceTab>("chats");
	const headerHeight = useHeaderHeight();

	const { workspace, host } = useWorkspaceHost(id ?? null);

	const { sessionsByWorkspace, isReady } = useHostAcpSessions(host);
	const sessionRows = useMemo(
		() => buildSessionRows(id ? (sessionsByWorkspace.get(id) ?? []) : []),
		[sessionsByWorkspace, id],
	);

	return (
		<View className="bg-background flex-1">
			<Stack.Screen options={glassHeaderOptions} />
			<View className="flex-1" style={{ paddingTop: headerHeight }}>
				<View className="px-4 pt-2 pb-1">
					<Text className="font-bold text-2xl" numberOfLines={1}>
						{workspace?.name ?? ""}
					</Text>
					<View className="mt-1 flex-row items-center gap-1.5">
						<Icon
							as={GitBranch}
							className="text-muted-foreground size-3.5"
							strokeWidth={1.8}
						/>
						<Text
							className="text-muted-foreground text-[13px]"
							numberOfLines={1}
						>
							{workspace?.branch ?? ""}
						</Text>
					</View>
				</View>
				{tab === "chats" ? (
					<ScrollView
						className="flex-1"
						contentContainerStyle={{ paddingTop: 10, paddingBottom: 16 }}
					>
						{sessionRows.map((row, index) => (
							<View key={row.id}>
								{index > 0 && (
									<View className="border-border/40 ml-12 border-t" />
								)}
								<SessionRow
									row={row}
									className="px-4 py-3"
									onPress={() =>
										router.push(
											`/(authenticated)/workspace/${id}/chat/acp/${row.id}`,
										)
									}
								/>
							</View>
						))}
						{sessionRows.length === 0 && isReady && (
							<View className="items-center py-20">
								<Text className="text-muted-foreground">
									No chats in this workspace yet
								</Text>
							</View>
						)}
					</ScrollView>
				) : (
					<DiffPlaceholder />
				)}
			</View>
			<WorkspaceTabBar tab={tab} onTabChange={setTab} />
		</View>
	);
}
