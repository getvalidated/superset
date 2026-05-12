import { Button } from "@superset/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { FoldVertical, UnfoldVertical } from "lucide-react";
import type { ChangesViewMode } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { ViewModeToggle } from "../ChangesHeader/components/ViewModeToggle";

interface ChangesToolbarProps {
	viewMode: ChangesViewMode;
	onViewModeChange: (next: ChangesViewMode) => void;
	/** Whether the last fold action was "collapse all". */
	collapsed: boolean;
	/** Toggle between collapse-all and expand-all across every section. */
	onToggleFold: () => void;
}

/**
 * Single action row beneath the changes header (above the section list): the
 * folders/tree view-mode toggle on the left, and one collapse/expand-all
 * toggle on the right that applies to every section's folder groups (folders
 * mode) or tree directories (tree mode).
 */
export function ChangesToolbar({
	viewMode,
	onViewModeChange,
	collapsed,
	onToggleFold,
}: ChangesToolbarProps) {
	const label = collapsed ? "Expand all" : "Collapse all";
	const Icon = collapsed ? UnfoldVertical : FoldVertical;
	return (
		<div className="flex items-center justify-end gap-1 border-b border-border px-2 py-0.5">
			<ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="size-5 text-muted-foreground hover:text-foreground"
						onClick={onToggleFold}
						aria-label={label}
					>
						<Icon className="size-3" />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">{label}</TooltipContent>
			</Tooltip>
		</div>
	);
}
