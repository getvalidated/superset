import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import {
	Bold,
	Hand,
	Italic,
	Maximize,
	Minus,
	MousePointer2,
	PaintBucket,
	Plus,
	Redo2,
	Slash,
	Square,
	Type,
	Undo2,
} from "lucide-react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { clampZoom } from "./canvasGeometry";
import {
	CANVAS_SHAPE_COLORS,
	CANVAS_TEXT_SIZES,
	type CanvasShapeColorOption,
	DEFAULT_CANVAS_TEXT_SIZE_PX,
} from "./canvasShapeStyle";
import type {
	CanvasDrawStyle,
	CanvasInteractionMode,
	CanvasShape,
	CanvasStore,
	CanvasTool,
} from "./canvasStore";

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

function ColorSwatch({
	option,
	active,
	onClick,
}: {
	option: CanvasShapeColorOption;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onClick}
					className={cn(
						"flex rounded p-1 transition-colors hover:bg-muted",
						active && "bg-muted",
					)}
				>
					<span
						className={cn(
							"size-3.5 rounded-full",
							option.css === null && "bg-foreground/60",
							active &&
								"ring-1 ring-foreground/50 ring-offset-1 ring-offset-background",
						)}
						style={option.css ? { backgroundColor: option.css } : undefined}
					/>
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom" showArrow={false}>
				{option.label}
			</TooltipContent>
		</Tooltip>
	);
}

/** Second toolbar row: shape styling controls. Drives either the draw style
 *  (while a tool is armed) or the current selection, depending on the caller.
 *  `color`/`fontSize` are null when the backing selection is mixed. */
function ShapeStyleRow({
	color,
	onColor,
	box,
	text,
}: {
	color: string | null;
	onColor: (key: string) => void;
	box?: { fill: boolean; onToggleFill: () => void };
	text?: {
		fontSize: number | null;
		onFontSize: (px: number) => void;
		bold: boolean;
		onToggleBold: () => void;
		italic: boolean;
		onToggleItalic: () => void;
	};
}) {
	return (
		<div className="flex items-center gap-0.5 border-t border-border pt-0.5">
			{CANVAS_SHAPE_COLORS.map((option) => (
				<ColorSwatch
					key={option.key}
					option={option}
					active={color === option.key}
					onClick={() => onColor(option.key)}
				/>
			))}
			{box && (
				<>
					<div className="mx-0.5 h-3.5 w-px bg-border" />
					<ToolbarButton
						label="Fill box"
						active={box.fill}
						onClick={box.onToggleFill}
					>
						<PaintBucket className="size-3.5" />
					</ToolbarButton>
				</>
			)}
			{text && (
				<>
					<div className="mx-0.5 h-3.5 w-px bg-border" />
					{CANVAS_TEXT_SIZES.map((size, index) => (
						<ToolbarButton
							key={size.label}
							label={`${size.label} text`}
							active={text.fontSize === size.px}
							onClick={() => text.onFontSize(size.px)}
						>
							<span
								className="flex size-3.5 items-center justify-center font-medium leading-none"
								style={{ fontSize: 8 + index * 3 }}
							>
								A
							</span>
						</ToolbarButton>
					))}
					<div className="mx-0.5 h-3.5 w-px bg-border" />
					<ToolbarButton
						label="Bold"
						active={text.bold}
						onClick={text.onToggleBold}
					>
						<Bold className="size-3.5" />
					</ToolbarButton>
					<ToolbarButton
						label="Italic"
						active={text.italic}
						onClick={text.onToggleItalic}
					>
						<Italic className="size-3.5" />
					</ToolbarButton>
				</>
			)}
		</div>
	);
}

/** Styling for the shape the armed tool will draw next. */
function DrawStyleRow({
	store,
	tool,
}: {
	store: StoreApi<CanvasStore>;
	tool: Exclude<CanvasTool, "select">;
}) {
	const drawStyle = useStore(store, (state) => state.drawStyle);
	const setDrawStyle = store.getState().setDrawStyle;

	return (
		<ShapeStyleRow
			color={drawStyle.color}
			onColor={(key) => setDrawStyle({ color: key })}
			box={
				tool === "box"
					? {
							fill: drawStyle.fill,
							onToggleFill: () => setDrawStyle({ fill: !drawStyle.fill }),
						}
					: undefined
			}
			text={
				tool === "text"
					? {
							fontSize: drawStyle.fontSize,
							onFontSize: (px) => setDrawStyle({ fontSize: px }),
							bold: drawStyle.bold,
							onToggleBold: () => setDrawStyle({ bold: !drawStyle.bold }),
							italic: drawStyle.italic,
							onToggleItalic: () => setDrawStyle({ italic: !drawStyle.italic }),
						}
					: undefined
			}
		/>
	);
}

/** The single value all shapes share, or null when mixed. */
function sharedValue<T>(values: T[]): T | null {
	return values.length > 0 && values.every((value) => value === values[0])
		? values[0]
		: null;
}

/** Restyles the selected shapes in place, undoably. Controls reflect the
 *  selection: a swatch/size lights up only when every applicable shape
 *  already has that value, and toggles turn on unless everything is on. */
function SelectionStyleRow({ store }: { store: StoreApi<CanvasStore> }) {
	const shapes = useStore(store, (state) => state.shapes);
	const selectedShapeIds = useStore(store, (state) => state.selectedShapeIds);
	const selected = [...selectedShapeIds]
		.map((id) => shapes[id])
		.filter((shape): shape is CanvasShape => Boolean(shape));
	if (selected.length === 0) return null;

	const boxes = selected.filter((shape) => shape.type === "box");
	const texts = selected.filter((shape) => shape.type === "text");

	const color = sharedValue(selected.map((shape) => shape.color ?? "default"));
	const allFilled = boxes.length > 0 && boxes.every((shape) => shape.fill);
	const fontSize = sharedValue(
		texts.map((shape) => shape.fontSize ?? DEFAULT_CANVAS_TEXT_SIZE_PX),
	);
	const allBold = texts.length > 0 && texts.every((shape) => shape.bold);
	const allItalic = texts.length > 0 && texts.every((shape) => shape.italic);

	const apply = (style: Partial<CanvasDrawStyle>) => {
		const state = store.getState();
		state.pushHistory();
		state.setShapesStyle([...state.selectedShapeIds], style);
	};

	return (
		<ShapeStyleRow
			color={color}
			onColor={(key) => {
				// Re-clicking the uniform color would only push a no-op undo entry.
				if (key !== color) apply({ color: key });
			}}
			box={
				boxes.length > 0
					? {
							fill: allFilled,
							onToggleFill: () => apply({ fill: !allFilled }),
						}
					: undefined
			}
			text={
				texts.length > 0
					? {
							fontSize,
							onFontSize: (px) => {
								if (px !== fontSize) apply({ fontSize: px });
							},
							bold: allBold,
							onToggleBold: () => apply({ bold: !allBold }),
							italic: allItalic,
							onToggleItalic: () => apply({ italic: !allItalic }),
						}
					: undefined
			}
		/>
	);
}

export function CanvasToolbar({
	store,
	onZoomStep,
	onZoomToFit,
}: {
	store: StoreApi<CanvasStore>;
	onZoomStep: (factor: number) => void;
	onZoomToFit: () => void;
}) {
	const zoom = useStore(store, (state) => state.camera.zoom);
	const activeTool = useStore(store, (state) => state.activeTool);
	const interactionMode = useStore(store, (state) => state.interactionMode);
	const canUndo = useStore(store, (state) => state.undoStack.length > 0);
	const canRedo = useStore(store, (state) => state.redoStack.length > 0);

	// Clicking the armed tool again disarms it back to select.
	const selectTool = (tool: CanvasTool) =>
		store.getState().setActiveTool(activeTool === tool ? "select" : tool);

	// Picking a mode also disarms any drawing tool, like Figma's V/H.
	const selectMode = (mode: CanvasInteractionMode) => {
		store.getState().setActiveTool("select");
		store.getState().setInteractionMode(mode);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: right-click on the toolbar must not open the canvas background menu
		<div
			data-canvas-ui
			className="absolute right-3 top-3 z-50 flex flex-col gap-0.5 rounded-lg border border-border bg-background/95 px-1 py-0.5 shadow-md"
			onContextMenu={(event) => event.stopPropagation()}
		>
			<div className="flex items-center gap-0.5">
				<ToolbarButton
					label="Select — drag to marquee-select (V)"
					active={activeTool === "select" && interactionMode === "select"}
					onClick={() => selectMode("select")}
				>
					<MousePointer2 className="size-3.5" />
				</ToolbarButton>
				<ToolbarButton
					label="Drag — drag to pan (H)"
					active={activeTool === "select" && interactionMode === "drag"}
					onClick={() => selectMode("drag")}
				>
					<Hand className="size-3.5" />
				</ToolbarButton>
				<div className="mx-0.5 h-3.5 w-px bg-border" />
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
			</div>
			{activeTool !== "select" ? (
				<DrawStyleRow store={store} tool={activeTool} />
			) : (
				<SelectionStyleRow store={store} />
			)}
		</div>
	);
}
