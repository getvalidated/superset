import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { cn } from "@superset/ui/utils";
import { Lock, LockOpen } from "lucide-react";
import {
	memo,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
} from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { getShapeBounds } from "./canvasGeometry";
import type { CanvasShape, CanvasStore } from "./canvasStore";
import { beginCanvasTranslationGesture } from "./canvasTranslationGesture";

/**
 * Drawn annotations (lines, boxes, text notes) on the canvas plane. Shapes
 * render underneath windows in canvas coordinates; they're only interactive
 * while the select tool is active, so they never steal clicks from a drawing
 * gesture. Selecting works like windows: click replaces the selection,
 * shift-click toggles, and dragging moves the whole selection.
 */
export function CanvasShapeLayer({ store }: { store: StoreApi<CanvasStore> }) {
	const shapes = useStore(store, (state) => state.shapes);
	const shapeOrder = useStore(store, (state) => state.shapeOrder);
	const selectedShapeIds = useStore(store, (state) => state.selectedShapeIds);
	const activeTool = useStore(store, (state) => state.activeTool);
	const editingShapeId = useStore(store, (state) => state.editingShapeId);

	return (
		<>
			{shapeOrder.map((shapeId) => {
				const shape = shapes[shapeId];
				if (!shape) return null;
				return (
					<CanvasShapeItem
						key={shapeId}
						shape={shape}
						store={store}
						isSelected={selectedShapeIds.has(shapeId)}
						isEditing={editingShapeId === shapeId}
						interactive={activeTool === "select"}
					/>
				);
			})}
		</>
	);
}

const CanvasShapeItem = memo(function CanvasShapeItem({
	shape,
	store,
	isSelected,
	isEditing,
	interactive,
}: {
	shape: CanvasShape;
	store: StoreApi<CanvasStore>;
	isSelected: boolean;
	isEditing: boolean;
	interactive: boolean;
}) {
	const gestureCleanupRef = useRef<(() => void) | null>(null);
	useEffect(() => () => gestureCleanupRef.current?.(), []);
	const locked = Boolean(shape.locked);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<Element>) => {
			// Locked shapes ignore select/drag but keep pointer events on so the
			// context menu can still reach them to unlock.
			if (event.button !== 0 || !interactive || locked) return;
			event.preventDefault();
			event.stopPropagation();
			const state = store.getState();
			if (event.shiftKey) {
				state.toggleShapeSelection(shape.id);
				return;
			}
			if (!state.selectedShapeIds.has(shape.id)) {
				state.setSelection([], [shape.id]);
			}
			const current = store.getState();
			gestureCleanupRef.current = beginCanvasTranslationGesture({
				store,
				event: event.nativeEvent,
				captureTarget: event.currentTarget,
				windowIds: [...current.selectedWindowIds],
				shapeIds: [...current.selectedShapeIds],
			});
		},
		[interactive, locked, shape.id, store],
	);

	const handleToggleLock = useCallback(() => {
		store.getState().pushHistory();
		store.getState().setItemsLocked([], [shape.id], !locked);
	}, [store, shape.id, locked]);

	const bounds = getShapeBounds(shape);
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: right-click on a shape must not open the canvas background menu */}
				<div
					data-canvas-shape={shape.id}
					className="absolute"
					style={{
						left: bounds.x,
						top: bounds.y,
						width: Math.max(bounds.width, 1),
						height: Math.max(bounds.height, 1),
						zIndex: 0,
						pointerEvents: "none",
					}}
					onContextMenu={(event) => event.stopPropagation()}
				>
					{shape.type === "text" ? (
						<TextShapeBody
							shape={shape}
							store={store}
							isSelected={isSelected}
							isEditing={isEditing}
							interactive={interactive}
							locked={locked}
							onPointerDown={handlePointerDown}
						/>
					) : (
						<StrokeShapeBody
							shape={shape}
							bounds={bounds}
							isSelected={isSelected}
							interactive={interactive}
							locked={locked}
							onPointerDown={handlePointerDown}
						/>
					)}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={handleToggleLock}>
					{locked ? (
						<LockOpen className="mr-2 size-4" />
					) : (
						<Lock className="mr-2 size-4" />
					)}
					{locked ? "Unlock" : "Lock"}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
});

function StrokeShapeBody({
	shape,
	bounds,
	isSelected,
	interactive,
	locked,
	onPointerDown,
}: {
	shape: Extract<CanvasShape, { type: "line" | "box" }>;
	bounds: { x: number; y: number; width: number; height: number };
	isSelected: boolean;
	interactive: boolean;
	locked: boolean;
	onPointerDown: (event: ReactPointerEvent<Element>) => void;
}) {
	const strokeClass = isSelected ? "stroke-primary" : "stroke-foreground/60";
	const hitProps = {
		stroke: "transparent",
		style: {
			pointerEvents: interactive ? ("stroke" as const) : ("none" as const),
			cursor: locked ? "default" : "move",
		},
		onPointerDown,
	};
	return (
		<svg
			className="absolute inset-0 h-full w-full overflow-visible"
			style={{ pointerEvents: "none" }}
			aria-hidden="true"
		>
			{shape.type === "line" ? (
				<>
					<line
						x1={shape.x1 - bounds.x}
						y1={shape.y1 - bounds.y}
						x2={shape.x2 - bounds.x}
						y2={shape.y2 - bounds.y}
						className={strokeClass}
						strokeWidth={2}
						strokeLinecap="round"
					/>
					<line
						x1={shape.x1 - bounds.x}
						y1={shape.y1 - bounds.y}
						x2={shape.x2 - bounds.x}
						y2={shape.y2 - bounds.y}
						strokeWidth={12}
						fill="none"
						{...hitProps}
					/>
				</>
			) : (
				<>
					<rect
						x={1}
						y={1}
						width={Math.max(bounds.width - 2, 1)}
						height={Math.max(bounds.height - 2, 1)}
						rx={6}
						fill="none"
						className={strokeClass}
						strokeWidth={2}
					/>
					<rect
						x={1}
						y={1}
						width={Math.max(bounds.width - 2, 1)}
						height={Math.max(bounds.height - 2, 1)}
						rx={6}
						strokeWidth={10}
						fill="none"
						{...hitProps}
					/>
				</>
			)}
		</svg>
	);
}

function TextShapeBody({
	shape,
	store,
	isSelected,
	isEditing,
	interactive,
	locked,
	onPointerDown,
}: {
	shape: Extract<CanvasShape, { type: "text" }>;
	store: StoreApi<CanvasStore>;
	isSelected: boolean;
	isEditing: boolean;
	interactive: boolean;
	locked: boolean;
	onPointerDown: (event: ReactPointerEvent<Element>) => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	const commitText = useCallback(
		(value: string) => {
			const state = store.getState();
			state.setEditingShape(null);
			if (value.trim() === "") {
				// Emptying a never-committed note is a cancel — its creation already
				// pushed history. Emptying a note that had text is a destructive
				// edit and needs its own snapshot, or the text is unrecoverable.
				if (shape.text !== "") state.pushHistory();
				state.removeShapes([shape.id]);
				return;
			}
			if (value !== shape.text) {
				state.pushHistory();
				state.setShapeText(shape.id, value);
			}
		},
		[shape.id, shape.text, store],
	);

	// Quitting mid-edit never blurs the textarea, so without this the typed
	// text would vanish with the window. The persistence hook's own pagehide
	// flush picks the mutation up synchronously.
	useEffect(() => {
		if (!isEditing) return;
		const handlePagehide = () => {
			const textarea = textareaRef.current;
			if (textarea) commitText(textarea.value);
		};
		window.addEventListener("pagehide", handlePagehide);
		return () => window.removeEventListener("pagehide", handlePagehide);
	}, [isEditing, commitText]);

	if (isEditing) {
		return (
			<textarea
				ref={textareaRef}
				// biome-ignore lint/a11y/noAutofocus: editing starts from an explicit user action (draw or double-click)
				autoFocus
				defaultValue={shape.text}
				placeholder="Type something…"
				className="absolute inset-0 h-full w-full resize-none rounded-md border border-primary bg-background p-2 text-sm text-foreground shadow-sm outline-none"
				style={{ pointerEvents: "auto" }}
				onFocus={(event) => event.currentTarget.select()}
				onBlur={(event) => commitText(event.currentTarget.value)}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (
						event.key === "Escape" ||
						(event.key === "Enter" && (event.metaKey || event.ctrlKey))
					) {
						event.currentTarget.blur();
					}
				}}
				onPointerDown={(event) => event.stopPropagation()}
			/>
		);
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: canvas object manipulated with pointer gestures
		<div
			className={cn(
				"absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border bg-background/80 p-2 text-sm text-foreground shadow-sm",
				isSelected ? "border-primary" : "border-border/70",
			)}
			style={{
				pointerEvents: interactive ? "auto" : "none",
				cursor: locked ? "default" : "move",
			}}
			onPointerDown={onPointerDown}
			onDoubleClick={(event) => {
				event.stopPropagation();
				// Locked notes are read-only until unlocked.
				if (!locked) store.getState().setEditingShape(shape.id);
			}}
		>
			{shape.text}
		</div>
	);
}
