import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { CanvasView } from "../v2-workspace/canvas";
import { V2WorkspacesHeader } from "./components/V2WorkspacesHeader";
import { V2WorkspacesList } from "./components/V2WorkspacesList";
import { useAccessibleV2Workspaces } from "./hooks/useAccessibleV2Workspaces";
import { useV2WorkspacesFilterStore } from "./stores/v2WorkspacesFilterStore";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-workspaces/",
)({
	component: V2WorkspacesPage,
});

function V2WorkspacesPage() {
	const searchQuery = useV2WorkspacesFilterStore((state) => state.searchQuery);
	const deviceFilter = useV2WorkspacesFilterStore(
		(state) => state.deviceFilter,
	);
	const projectFilter = useV2WorkspacesFilterStore(
		(state) => state.projectFilter,
	);
	const setSearchQuery = useV2WorkspacesFilterStore(
		(state) => state.setSearchQuery,
	);

	useEffect(() => {
		setSearchQuery("");
	}, [setSearchQuery]);

	const { all, counts, hostOptions, projectOptions, hostsById, projectsById } =
		useAccessibleV2Workspaces({
			searchQuery,
			deviceFilter,
			projectFilter,
		});

	const { preferences } = useV2UserPreferences();
	// The canvas display mode is global, not workspace-bound — it shows here
	// too, so toggling to canvas works with no workspace selected. Older
	// persisted rows read displayMode as undefined; treat that as tabs.
	if ((preferences.displayMode ?? "tabs") === "canvas") {
		return (
			<div className="flex h-full w-full flex-1 flex-col overflow-hidden">
				<CanvasView />
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-1 flex-col overflow-hidden">
			<V2WorkspacesHeader
				counts={counts}
				hostOptions={hostOptions}
				projectOptions={projectOptions}
				hostsById={hostsById}
				projectsById={projectsById}
			/>
			<V2WorkspacesList workspaces={all} />
		</div>
	);
}
