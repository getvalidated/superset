import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import {
	Columns3,
	Maximize,
	Minus,
	Plus,
	Search,
	Settings,
} from "lucide-react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { clampZoom } from "./canvasGeometry";
import type { CanvasStore } from "./canvasStore";

function ToolbarButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onClick}
					className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{children}
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom" showArrow={false}>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

export function CanvasToolbar({
	store,
	onZoomStep,
	onZoomToFit,
	onOpenSearch,
	onOpenSettings,
	onExit,
}: {
	store: StoreApi<CanvasStore>;
	onZoomStep: (factor: number) => void;
	onZoomToFit: () => void;
	onOpenSearch: () => void;
	onOpenSettings: () => void;
	onExit: () => void;
}) {
	const zoom = useStore(store, (state) => state.camera.zoom);

	return (
		<div
			data-canvas-ui
			className="absolute right-3 top-3 z-50 flex items-center gap-0.5 rounded-lg border border-border bg-background/95 px-1 py-0.5 shadow-md"
		>
			<ToolbarButton label="Zoom out" onClick={() => onZoomStep(1 / 1.2)}>
				<Minus className="size-3.5" />
			</ToolbarButton>
			<span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
				{Math.round(clampZoom(zoom) * 100)}%
			</span>
			<ToolbarButton label="Zoom in" onClick={() => onZoomStep(1.2)}>
				<Plus className="size-3.5" />
			</ToolbarButton>
			<ToolbarButton label="Zoom to fit" onClick={onZoomToFit}>
				<Maximize className="size-3.5" />
			</ToolbarButton>
			<div className="mx-0.5 h-3.5 w-px bg-border" />
			<ToolbarButton label="New search window" onClick={onOpenSearch}>
				<Search className="size-3.5" />
			</ToolbarButton>
			<ToolbarButton label="Settings window" onClick={onOpenSettings}>
				<Settings className="size-3.5" />
			</ToolbarButton>
			<div className="mx-0.5 h-3.5 w-px bg-border" />
			<ToolbarButton label="Back to tabs" onClick={onExit}>
				<Columns3 className="size-3.5" />
			</ToolbarButton>
		</div>
	);
}
