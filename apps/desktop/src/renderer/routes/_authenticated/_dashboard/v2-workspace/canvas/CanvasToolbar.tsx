import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import {
	Columns3,
	Globe,
	Maximize,
	Minus,
	MousePointer2,
	Plus,
	Redo2,
	Search,
	Settings,
	Slash,
	Square,
	Type,
	Undo2,
} from "lucide-react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { clampZoom } from "./canvasGeometry";
import type { CanvasStore, CanvasTool } from "./canvasStore";

function ToolbarButton({
	label,
	onClick,
	active = false,
	disabled = false,
	children,
}: {
	label: string;
	onClick: () => void;
	active?: boolean;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onClick}
					disabled={disabled}
					className={cn(
						"rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
						active && "bg-muted text-foreground",
						disabled && "pointer-events-none opacity-40",
					)}
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
	onOpenBrowser,
	onOpenSearch,
	onOpenSettings,
	onExit,
}: {
	store: StoreApi<CanvasStore>;
	onZoomStep: (factor: number) => void;
	onZoomToFit: () => void;
	onOpenBrowser: () => void;
	onOpenSearch: () => void;
	onOpenSettings: () => void;
	onExit: () => void;
}) {
	const zoom = useStore(store, (state) => state.camera.zoom);
	const activeTool = useStore(store, (state) => state.activeTool);
	const canUndo = useStore(store, (state) => state.undoStack.length > 0);
	const canRedo = useStore(store, (state) => state.redoStack.length > 0);

	// Clicking the armed tool again disarms it back to select.
	const selectTool = (tool: CanvasTool) =>
		store.getState().setActiveTool(activeTool === tool ? "select" : tool);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: right-click on the toolbar must not open the canvas background menu
		<div
			data-canvas-ui
			className="absolute right-3 top-3 z-50 flex items-center gap-0.5 rounded-lg border border-border bg-background/95 px-1 py-0.5 shadow-md"
			onContextMenu={(event) => event.stopPropagation()}
		>
			<ToolbarButton
				label="Select"
				active={activeTool === "select"}
				onClick={() => store.getState().setActiveTool("select")}
			>
				<MousePointer2 className="size-3.5" />
			</ToolbarButton>
			<ToolbarButton
				label="Draw line"
				active={activeTool === "line"}
				onClick={() => selectTool("line")}
			>
				<Slash className="size-3.5" />
			</ToolbarButton>
			<ToolbarButton
				label="Draw box"
				active={activeTool === "box"}
				onClick={() => selectTool("box")}
			>
				<Square className="size-3.5" />
			</ToolbarButton>
			<ToolbarButton
				label="Add text"
				active={activeTool === "text"}
				onClick={() => selectTool("text")}
			>
				<Type className="size-3.5" />
			</ToolbarButton>
			<div className="mx-0.5 h-3.5 w-px bg-border" />
			<ToolbarButton
				label="Undo"
				disabled={!canUndo}
				onClick={() => store.getState().undo()}
			>
				<Undo2 className="size-3.5" />
			</ToolbarButton>
			<ToolbarButton
				label="Redo"
				disabled={!canRedo}
				onClick={() => store.getState().redo()}
			>
				<Redo2 className="size-3.5" />
			</ToolbarButton>
			<div className="mx-0.5 h-3.5 w-px bg-border" />
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
			<ToolbarButton label="New browser window" onClick={onOpenBrowser}>
				<Globe className="size-3.5" />
			</ToolbarButton>
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
