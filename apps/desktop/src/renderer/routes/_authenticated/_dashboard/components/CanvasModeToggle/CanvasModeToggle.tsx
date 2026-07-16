import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { Columns3, LayoutDashboard } from "lucide-react";
import { useIsV2CloudEnabled } from "renderer/hooks/useIsV2CloudEnabled";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";

/**
 * Header toggle between the tabbed workspace layout and the org-global
 * canvas. The mode is a global preference, not a workspace one, so this
 * lives in the window chrome and works with no workspace selected.
 */
export function CanvasModeToggle() {
	const isV2CloudEnabled = useIsV2CloudEnabled();
	const { preferences, setDisplayMode } = useV2UserPreferences();
	// Older persisted rows read displayMode as undefined (live reads skip zod
	// defaults) — treat that as tabs.
	const isCanvas = (preferences.displayMode ?? "tabs") === "canvas";
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();

	if (!isV2CloudEnabled) return null;

	const toggle = () => {
		const next = isCanvas ? "tabs" : "canvas";
		setDisplayMode(next);
		// The canvas renders on workspace pages and the workspaces list — from
		// any other route, go where it's visible.
		if (
			next === "canvas" &&
			!matchRoute({ to: "/v2-workspace/$workspaceId", fuzzy: true }) &&
			!matchRoute({ to: "/v2-workspaces" })
		) {
			void navigate({ to: "/v2-workspaces" });
		}
	};

	return (
		<Tooltip delayDuration={300}>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={toggle}
					className="no-drag flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
				>
					{isCanvas ? (
						<Columns3 className="size-4" strokeWidth={1.5} />
					) : (
						<LayoutDashboard className="size-4" strokeWidth={1.5} />
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{isCanvas
					? "Back to tabs"
					: "Canvas view — all sessions on an infinite plane"}
			</TooltipContent>
		</Tooltip>
	);
}
