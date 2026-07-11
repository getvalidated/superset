import { prompt } from "@superset/alert-prompt";
import type { SelectV2Host } from "@superset/db/schema";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { Alert } from "react-native";
import type { HostWorkspaceRow } from "@/hooks/useHostWorkspaces";
import {
	buildRelayHostUrl,
	getHostServiceClientByUrl,
} from "@/lib/host-service/client";

export function WorkspaceToolbarMenu({
	workspace,
	host,
}: {
	workspace: HostWorkspaceRow | null;
	host: SelectV2Host | null;
}) {
	const queryClient = useQueryClient();

	const renameWorkspace = async () => {
		if (!workspace) return;
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

	return (
		<Stack.Toolbar placement="right">
			<Stack.Toolbar.Menu
				icon="ellipsis"
				accessibilityLabel="Workspace options"
				hidden={!workspace}
			>
				<Stack.Toolbar.MenuAction
					icon="doc.on.doc"
					onPress={() => {
						if (workspace) void Clipboard.setStringAsync(workspace.branch);
					}}
				>
					Copy branch
				</Stack.Toolbar.MenuAction>
				<Stack.Toolbar.MenuAction
					icon="pencil"
					onPress={() => void renameWorkspace()}
				>
					Rename workspace
				</Stack.Toolbar.MenuAction>
			</Stack.Toolbar.Menu>
		</Stack.Toolbar>
	);
}
