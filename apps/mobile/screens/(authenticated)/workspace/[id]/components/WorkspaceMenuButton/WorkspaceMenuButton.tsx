import { prompt } from "@superset/alert-prompt";
import type { SelectV2Host } from "@superset/db/schema";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Ellipsis } from "lucide-react-native";
import { ActionSheetIOS, Alert, Pressable, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import type { HostWorkspaceRow } from "@/hooks/useHostWorkspaces";
import {
	buildRelayHostUrl,
	getHostServiceClientByUrl,
} from "@/lib/host-service/client";

const GLASS = isLiquidGlassAvailable();

export function WorkspaceMenuButton({
	workspace,
	host,
}: {
	workspace: HostWorkspaceRow | null;
	host: SelectV2Host | null;
}) {
	const queryClient = useQueryClient();
	if (!workspace) return null;

	const renameWorkspace = async () => {
		if (!host) {
			Alert.alert("Host is not online");
			return;
		}
		const name = await prompt({
			title: "Rename workspace",
			defaultValue: workspace.name,
			confirmText: "Rename",
			selectText: true,
		});
		const trimmed = name?.trim();
		if (!trimmed || trimmed === workspace.name) return;
		try {
			const hostUrl = buildRelayHostUrl(host.organizationId, host.machineId);
			await getHostServiceClientByUrl(hostUrl).workspace.update.mutate({
				id: workspace.id,
				name: trimmed,
			});
		} catch {
			Alert.alert("Rename failed");
		}
		void queryClient.invalidateQueries({
			queryKey: ["host-service", "workspaces", "list"],
		});
	};

	const openMenu = () => {
		ActionSheetIOS.showActionSheetWithOptions(
			{
				options: ["Copy branch", "Rename workspace", "Cancel"],
				cancelButtonIndex: 2,
			},
			(index) => {
				if (index === 0) void Clipboard.setStringAsync(workspace.branch);
				if (index === 1) void renameWorkspace();
			},
		);
	};

	const icon = (
		<View className="size-9 items-center justify-center">
			<Icon as={Ellipsis} className="text-foreground size-5" />
		</View>
	);

	if (!GLASS) {
		return (
			<Pressable
				accessibilityLabel="Workspace options"
				className="border-border bg-card rounded-full border"
				onPress={openMenu}
			>
				{icon}
			</Pressable>
		);
	}
	return (
		<Pressable accessibilityLabel="Workspace options" onPress={openMenu}>
			<GlassView
				// Dark-pinned to avoid the glass-material theme-toggle bug (expo #43743);
				// the app is dark-only.
				colorScheme="dark"
				glassEffectStyle="regular"
				style={{ borderRadius: 999, overflow: "hidden" }}
			>
				{icon}
			</GlassView>
		</Pressable>
	);
}
