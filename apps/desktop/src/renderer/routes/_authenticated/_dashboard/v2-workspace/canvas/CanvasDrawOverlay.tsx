import { cn } from "@superset/ui/utils";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useState,
} from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import {
	type CanvasPoint,
	canvasToScreen,
	rectFromPoints,
	screenToCanvas,
} from "./canvasGeometry";
import {
	canvasShapeFillColor,
	DEFAULT_CANVAS_TEXT_SIZE_PX,
	resolveCanvasShapeColor,
} from "./canvasShapeStyle";
import type {
	CanvasDrawStyle,
	CanvasShape,
	CanvasStore,
	CanvasTool,
} from "./canvasStore";

/** Drags shorter than this (screen px) are treated as clicks. */
const MIN_DRAW_DRAG_PX = 4;

const DEFAULT_TEXT_WIDTH = 240;
const DEFAULT_TEXT_HEIGHT = 96;
const MIN_TEXT_WIDTH = 96;
const MIN_TEXT_HEIGHT = 48;

/**
 * Full-viewport capture surface armed while a drawing tool (line/box/text) is
 * active. Pointer positions convert to canvas coordinates at event time; the
 * in-progress preview renders in screen coordinates. Committing a shape is one
 * undoable store mutation, then the tool snaps back to select.
 */
export function CanvasDrawOverlay({ store }: { store: StoreApi<CanvasStore> }) {
	const activeTool = useStore(store, (state) => state.activeTool);
	if (activeTool === "select") return null;
	return <DrawSurface store={store} tool={activeTool} />;
}

function DrawSurface({
	store,
	tool,
}: {
	store: StoreApi<CanvasStore>;
	tool: Exclude<CanvasTool, "select">;
}) {
	const [draft, setDraft] = useState<{
		start: CanvasPoint;
		current: CanvasPoint;
	} | null>(null);

	const toCanvasPoint = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>): CanvasPoint => {
			const rect = event.currentTarget.getBoundingClientRect();
			return screenToCanvas(
				{ x: event.clientX - rect.left, y: event.clientY - rect.top },
				store.getState().camera,
			);
		},
		[store],
	);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			const point = toCanvasPoint(event);
			setDraft({ start: point, current: point });
		},
		[toCanvasPoint],
	);

	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!draft) return;
			const point = toCanvasPoint(event);
			setDraft({ start: draft.start, current: point });
		},
		[draft, toCanvasPoint],
	);

	const handlePointerEnd = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!draft) return;
			setDraft(null);
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				// Capture already released.
			}
			if (event.type === "pointercancel") return;
			const state = store.getState();
			const end = toCanvasPoint(event);
			const dragPx =
				Math.hypot(end.x - draft.start.x, end.y - draft.start.y) *
				state.camera.zoom;
			const shape = buildShape(tool, draft.start, end, dragPx, state.drawStyle);
			if (!shape) return;
			state.pushHistory();
			state.upsertShapes([shape]);
			state.setSelection([], [shape.id]);
			if (shape.type === "text") state.setEditingShape(shape.id);
			state.setActiveTool("select");
		},
		[draft, store, tool, toCanvasPoint],
	);

	return (
		<div
			data-canvas-ui
			className="absolute inset-0 z-40 cursor-crosshair"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerEnd}
			onPointerCancel={handlePointerEnd}
		>
			{draft ? <DraftPreview store={store} tool={tool} draft={draft} /> : null}
		</div>
	);
}

function buildShape(
	tool: Exclude<CanvasTool, "select">,
	start: CanvasPoint,
	end: CanvasPoint,
	dragPx: number,
	style: CanvasDrawStyle,
): CanvasShape | null {
	const id = crypto.randomUUID();
	// Stamp only non-default style fields so unstyled shapes stay identical to
	// rows written before styling existed.
	const color = resolveCanvasShapeColor(style.color)
		? { color: style.color }
		: {};
	switch (tool) {
		case "line": {
			if (dragPx < MIN_DRAW_DRAG_PX) return null;
			return {
				id,
				type: "line",
				x1: start.x,
				y1: start.y,
				x2: end.x,
				y2: end.y,
				...color,
			};
		}
		case "box": {
			if (dragPx < MIN_DRAW_DRAG_PX) return null;
			const rect = rectFromPoints(start, end);
			return {
				id,
				type: "box",
				x: rect.x,
				y: rect.y,
				width: Math.max(rect.width, 1),
				height: Math.max(rect.height, 1),
				...color,
				...(style.fill ? { fill: true } : {}),
			};
		}
		case "text": {
			// A click drops a default-sized note; a drag sizes it explicitly.
			const rect =
				dragPx < MIN_DRAW_DRAG_PX
					? {
							x: start.x,
							y: start.y,
							width: DEFAULT_TEXT_WIDTH,
							height: DEFAULT_TEXT_HEIGHT,
						}
					: rectFromPoints(start, end);
			return {
				id,
				type: "text",
				x: rect.x,
				y: rect.y,
				width: Math.max(rect.width, MIN_TEXT_WIDTH),
				height: Math.max(rect.height, MIN_TEXT_HEIGHT),
				text: "",
				...color,
				...(style.fontSize !== DEFAULT_CANVAS_TEXT_SIZE_PX
					? { fontSize: style.fontSize }
					: {}),
				...(style.bold ? { bold: true } : {}),
				...(style.italic ? { italic: true } : {}),
			};
		}
	}
}

function DraftPreview({
	store,
	tool,
	draft,
}: {
	store: StoreApi<CanvasStore>;
	tool: Exclude<CanvasTool, "select">;
	draft: { start: CanvasPoint; current: CanvasPoint };
}) {
	// Re-rendered on every pointermove, so reading the camera imperatively
	// keeps the preview glued to the plane without a camera subscription.
	const { camera, drawStyle } = store.getState();
	const start = canvasToScreen(draft.start, camera);
	const current = canvasToScreen(draft.current, camera);
	const rect = rectFromPoints(start, current);
	const strokeCss = resolveCanvasShapeColor(drawStyle.color);
	const strokeClass = strokeCss ? undefined : "stroke-primary";
	const strokeStyle = strokeCss ? { stroke: strokeCss } : undefined;
	const fillCss =
		tool === "box" && drawStyle.fill
			? (canvasShapeFillColor(drawStyle.color) ?? undefined)
			: undefined;
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			aria-hidden="true"
		>
			{tool === "line" ? (
				<line
					x1={start.x}
					y1={start.y}
					x2={current.x}
					y2={current.y}
					className={strokeClass}
					style={strokeStyle}
					strokeWidth={2}
					strokeLinecap="round"
				/>
			) : (
				<rect
					x={rect.x}
					y={rect.y}
					width={rect.width}
					height={rect.height}
					rx={6}
					fill={fillCss ?? "none"}
					className={cn(
						strokeClass,
						tool === "box" &&
							drawStyle.fill &&
							!fillCss &&
							"fill-foreground/10",
					)}
					style={strokeStyle}
					strokeWidth={2}
					strokeDasharray={tool === "text" ? "6 4" : undefined}
				/>
			)}
		</svg>
	);
}
