import type { SelectV2Workspace } from "@superset/db/schema";
import { useLiveQuery } from "@tanstack/react-db";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useOrganizations } from "@/screens/(authenticated)/hooks/useOrganizations";
import { useCollections } from "@/screens/(authenticated)/providers/CollectionsProvider";
import { OrganizationHeaderButton } from "./components/OrganizationHeaderButton";
import { OrganizationSwitcherSheet } from "./components/OrganizationSwitcherSheet";

type ProjectGroup = {
	projectId: string;
	projectName: string;
	workspaces: SelectV2Workspace[];
};

export function WorkspacesScreen() {
	const router = useRouter();
	const [sheetOpen, setSheetOpen] = useState(false);
	const { width } = useWindowDimensions();
	const collections = useCollections();
	const {
		organizations,
		activeOrganization,
		activeOrganizationId,
		switchOrganization,
	} = useOrganizations();

	const { data: workspaces } = useLiveQuery(
		(q) => q.from({ v2Workspaces: collections.v2Workspaces }),
		[collections],
	);
	const { data: projects } = useLiveQuery(
		(q) => q.from({ v2Projects: collections.v2Projects }),
		[collections],
	);

	const groups = useMemo<ProjectGroup[]>(() => {
		const projectNames = new Map(
			(projects ?? []).map((project) => [project.id, project.name]),
		);
		const byProject = new Map<string, SelectV2Workspace[]>();
		for (const workspace of workspaces ?? []) {
			const list = byProject.get(workspace.projectId) ?? [];
			list.push(workspace);
			byProject.set(workspace.projectId, list);
		}
		return [...byProject.entries()]
			.map(([projectId, items]) => ({
				projectId,
				projectName: projectNames.get(projectId) ?? "Project",
				workspaces: items.sort(
					(a, b) =>
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				),
			}))
			.sort((a, b) => a.projectName.localeCompare(b.projectName));
	}, [workspaces, projects]);

	const handleSwitchOrganization = (organizationId: string) => {
		setSheetOpen(false);
		switchOrganization(organizationId);
	};

	return (
		<>
			<OrganizationHeaderButton
				name={activeOrganization?.name}
				logo={activeOrganization?.logo}
				onPress={() => setSheetOpen(true)}
			/>
			<ScrollView
				className="flex-1 bg-background"
				contentInsetAdjustmentBehavior="automatic"
				contentContainerClassName="p-4 pb-28 gap-6"
			>
				{groups.length === 0 ? (
					<View className="items-center justify-center py-20">
						<Text className="text-center text-muted-foreground">
							No workspaces yet. Create one from the desktop app to see it here.
						</Text>
					</View>
				) : (
					groups.map((group) => (
						<View key={group.projectId} className="gap-2">
							<Text className="text-muted-foreground px-1 text-xs font-medium uppercase">
								{group.projectName}
							</Text>
							{group.workspaces.map((workspace) => (
								<Pressable
									key={workspace.id}
									className="bg-card border-border active:bg-accent rounded-xl border p-4"
									onPress={() =>
										router.push(
											`/(authenticated)/workspace/${workspace.id}/chat`,
										)
									}
								>
									<Text className="font-medium" numberOfLines={1}>
										{workspace.name}
									</Text>
									<Text
										className="text-muted-foreground mt-1 font-mono text-xs"
										numberOfLines={1}
									>
										{workspace.branch}
									</Text>
								</Pressable>
							))}
						</View>
					))
				)}
			</ScrollView>
			<OrganizationSwitcherSheet
				isPresented={sheetOpen}
				onIsPresentedChange={setSheetOpen}
				organizations={organizations}
				activeOrganizationId={activeOrganizationId}
				onSwitchOrganization={handleSwitchOrganization}
				width={width}
			/>
		</>
	);
}
