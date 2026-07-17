import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useIsV2CloudEnabled } from "renderer/hooks/useIsV2CloudEnabled";

export const Route = createFileRoute("/")({
	component: RootIndexPage,
});

function RootIndexPage() {
	// "/workspace" is the v1 home; sending a v2 user there restores their
	// last-viewed v1 workspace and lands on the cross-version dead-end state.
	const isV2CloudEnabled = useIsV2CloudEnabled();
	return (
		<Navigate to={isV2CloudEnabled ? "/v2-workspaces" : "/workspace"} replace />
	);
}
