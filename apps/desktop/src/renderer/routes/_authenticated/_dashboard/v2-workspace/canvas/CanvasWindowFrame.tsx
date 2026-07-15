import { cn } from "@superset/ui/utils";
import { Globe, TerminalSquare } from "lucide-react";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import type { StoreApi } from "zustand/vanilla";
import { browserRuntimeRegistry } from "../$workspaceId/hooks/usePaneRegistry/components/BrowserPane";
import {
	MIN_CANVAS_WINDOW_HEIGHT,
	MIN_CANVAS_WINDOW_WIDTH,
} from "./canvasGeometry";
import type { CanvasStore, CanvasWindow } from "./canvasStore";
import type { CanvasTerminalData } from "./useCanvasSeeding";

interface ResizeEdges {
	left?: boolean;
	right?: boolean;
	top?: boolean;
	bottom?: boolean;
}

const RESIZE_HANDLES: Array<{
	key: string;
	edges: ResizeEdges;
	className: string;
}> = [
	{
		key: "n",
		edges: { top: true },
		className: "left-2 right-2 -top-1 h-2 cursor-ns-resize",
	},
	{
		key: "s",
		edges: { bottom: true },
		className: "left-2 right-2 -bottom-1 h-2 cursor-ns-resize",
	},
	{
		key: "w",
		edges: { left: true },
		className: "top-2 bottom-2 -left-1 w-2 cursor-ew-resize",
	},
	{
		key: "e",
		edges: { right: true },
		className: "top-2 bottom-2 -right-1 w-2 cursor-ew-resize",
	},
	{
		key: "nw",
		edges: { top: true, left: true },
		className: "-top-1 -left-1 size-3 cursor-nwse-resize",
	},
	{
		key: "ne",
		edges: { top: true, right: true },
		className: "-top-1 -right-1 size-3 cursor-nesw-resize",
	},
	{
		key: "sw",
		edges: { bottom: true, left: true },
		className: "-bottom-1 -left-1 size-3 cursor-nesw-resize",
	},
	{
		key: "se",
		edges: { bottom: true, right: true },
		className: "-bottom-1 -right-1 size-3 cursor-nwse-resize",
	},
];

function useTerminalWindowTitle(window: CanvasWindow): string {
	const data = window.data as CanvasTerminalData;
	const terminalId = window.kind === "terminal" ? data.terminalId : null;
	const runtimeTitle = useSyncExternalStore(
		useCallback(
			(callback) =>
				terminalId
					? terminalRuntimeRegistry.onTitleChange(
							terminalId,
							callback,
							window.id,
						)
					: () => {},
			[terminalId, window.id],
		),
		useCallback(
			() =>
				terminalId
					? (terminalRuntimeRegistry.getTitle(terminalId, window.id) ?? null)
					: null,
			[terminalId, window.id],
		),
	);
	if (window.kind !== "terminal") return "";
	return runtimeTitle?.trim() || data.title?.trim() || "Terminal";
}

/**
 * A draggable/resizable window on the canvas plane. Geometry lives in canvas
 * (unzoomed) coordinates; drags divide pointer deltas by the camera zoom.
 * Position updates during a drag are imperative (style writes + webview
 * relayout) — the store commit happens once on pointerup.
 */
export function CanvasWindowFrame({
	window,
	store,
	zIndex,
	isFocused,
	workspaceLabel,
	children,
}: {
	window: CanvasWindow;
	store: StoreApi<CanvasStore>;
	zIndex: number;
	isFocused: boolean;
	workspaceLabel: string;
	children: ReactNode;
}) {
	const frameRef = useRef<HTMLDivElement | null>(null);
	const gestureCleanupRef = useRef<(() => void) | null>(null);
	const terminalTitle = useTerminalWindowTitle(window);

	useEffect(() => () => gestureCleanupRef.current?.(), []);

	const focusWindow = useCallback(() => {
		store.getState().bringToFront(window.id);
		store.getState().setFocusedWindow(window.id);
	}, [store, window.id]);

	const beginGeometryGesture = useCallback(
		(
			event: ReactPointerEvent<HTMLDivElement>,
			apply: (
				deltaX: number,
				deltaY: number,
			) => {
				x: number;
				y: number;
				width: number;
				height: number;
			},
		) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			focusWindow();
			const frame = frameRef.current;
			if (!frame) return;
			const target = event.currentTarget;
			const pointerId = event.pointerId;
			const startX = event.clientX;
			const startY = event.clientY;
			let latest = {
				x: window.x,
				y: window.y,
				width: window.width,
				height: window.height,
			};
			target.setPointerCapture(pointerId);
			store.getState().setGestureActive(true);
			browserRuntimeRegistry.setShellInteractionPassthrough(true);

			const handleMove = (moveEvent: PointerEvent) => {
				if (moveEvent.pointerId !== pointerId) return;
				const zoom = store.getState().camera.zoom;
				latest = apply(
					(moveEvent.clientX - startX) / zoom,
					(moveEvent.clientY - startY) / zoom,
				);
				frame.style.left = `${latest.x}px`;
				frame.style.top = `${latest.y}px`;
				frame.style.width = `${latest.width}px`;
				frame.style.height = `${latest.height}px`;
				browserRuntimeRegistry.relayoutAll();
			};
			let finished = false;
			const endGesture = (commit: boolean) => {
				if (finished) return;
				finished = true;
				gestureCleanupRef.current = null;
				target.removeEventListener("pointermove", handleMove);
				target.removeEventListener("pointerup", handleEnd);
				target.removeEventListener("pointercancel", handleEnd);
				try {
					target.releasePointerCapture(pointerId);
				} catch {
					// Capture already released.
				}
				browserRuntimeRegistry.setShellInteractionPassthrough(false);
				if (commit) store.getState().setWindowGeometry(window.id, latest);
				store.getState().setGestureActive(false);
				requestAnimationFrame(() => browserRuntimeRegistry.relayoutAll());
			};
			const handleEnd = (endEvent: PointerEvent) => {
				if (endEvent.pointerId !== pointerId) return;
				endGesture(true);
			};
			gestureCleanupRef.current = () => endGesture(false);
			target.addEventListener("pointermove", handleMove);
			target.addEventListener("pointerup", handleEnd);
			target.addEventListener("pointercancel", handleEnd);
		},
		[focusWindow, store, window],
	);

	const handleTitleBarPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const { x, y, width, height } = window;
			beginGeometryGesture(event, (dx, dy) => ({
				x: x + dx,
				y: y + dy,
				width,
				height,
			}));
		},
		[beginGeometryGesture, window],
	);

	const makeResizeHandler = useCallback(
		(edges: ResizeEdges) => (event: ReactPointerEvent<HTMLDivElement>) => {
			const { x, y, width, height } = window;
			beginGeometryGesture(event, (dx, dy) => {
				let nextX = x;
				let nextY = y;
				let nextWidth = width;
				let nextHeight = height;
				if (edges.right) nextWidth = width + dx;
				if (edges.bottom) nextHeight = height + dy;
				if (edges.left) {
					nextWidth = width - dx;
					nextX = x + dx;
				}
				if (edges.top) {
					nextHeight = height - dy;
					nextY = y + dy;
				}
				if (nextWidth < MIN_CANVAS_WINDOW_WIDTH) {
					if (edges.left) nextX -= MIN_CANVAS_WINDOW_WIDTH - nextWidth;
					nextWidth = MIN_CANVAS_WINDOW_WIDTH;
				}
				if (nextHeight < MIN_CANVAS_WINDOW_HEIGHT) {
					if (edges.top) nextY -= MIN_CANVAS_WINDOW_HEIGHT - nextHeight;
					nextHeight = MIN_CANVAS_WINDOW_HEIGHT;
				}
				return { x: nextX, y: nextY, width: nextWidth, height: nextHeight };
			});
		},
		[beginGeometryGesture, window],
	);

	const handleDismiss = useCallback(() => {
		if (window.kind === "terminal") {
			const { terminalId } = window.data as CanvasTerminalData;
			terminalRuntimeRegistry.release(terminalId, window.id);
		}
		store.getState().removeWindows([window.id], { dismiss: true });
	}, [store, window]);

	return (
		<div
			ref={frameRef}
			data-canvas-window={window.id}
			className={cn(
				"absolute flex flex-col overflow-hidden rounded-lg border bg-background shadow-lg",
				isFocused ? "border-primary/60 shadow-xl" : "border-border",
			)}
			style={{
				left: window.x,
				top: window.y,
				width: window.width,
				height: window.height,
				zIndex,
			}}
			onPointerDownCapture={focusWindow}
		>
			<div
				className="flex h-8 shrink-0 cursor-grab select-none items-center gap-1.5 border-b border-border/60 bg-muted/40 px-2 active:cursor-grabbing"
				onPointerDown={handleTitleBarPointerDown}
			>
				{window.kind === "terminal" ? (
					<TerminalSquare className="size-3.5 shrink-0 text-muted-foreground" />
				) : (
					<Globe className="size-3.5 shrink-0 text-muted-foreground" />
				)}
				<span className="min-w-0 truncate text-xs text-foreground">
					{window.kind === "terminal"
						? terminalTitle
						: browserWindowTitle(window)}
				</span>
				<span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground">
					{workspaceLabel}
				</span>
				<button
					type="button"
					className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={handleDismiss}
					title="Remove from canvas"
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 12 12"
						className="size-3"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<path d="M3 3l6 6M9 3l-6 6" />
					</svg>
				</button>
			</div>
			<div data-canvas-window-body className="min-h-0 flex-1">
				{children}
			</div>
			{RESIZE_HANDLES.map((handle) => (
				<div
					key={handle.key}
					className={cn("absolute z-10", handle.className)}
					onPointerDown={makeResizeHandler(handle.edges)}
				/>
			))}
		</div>
	);
}

function browserWindowTitle(window: CanvasWindow): string {
	const data = window.data as { url?: string; pageTitle?: string };
	if (data.pageTitle) return data.pageTitle;
	if (data.url && data.url !== "about:blank") {
		try {
			return new URL(data.url).host;
		} catch {
			// Fall through to the generic label.
		}
	}
	return "Browser";
}

/**
 * Stand-in for a culled (off-viewport) mirrored browser window. The webview
 * stays alive in the registry — just detached and hidden, so page state
 * survives and pan-time relayout skips it. Panning it back into view (or
 * clicking to focus) reattaches it in place.
 */
export function CanvasBrowserPlaceholder({ window }: { window: CanvasWindow }) {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background/60">
			<Globe className="size-8 text-muted-foreground/40" />
			<span className="max-w-[80%] truncate text-xs text-muted-foreground">
				{browserWindowTitle(window)}
			</span>
			<span className="text-[10px] text-muted-foreground/60">
				off-screen — click to focus
			</span>
		</div>
	);
}

/**
 * Stand-in for a culled terminal window (off-viewport, far zoom-out, or over
 * the live-terminal cap). The runtime stays parked; clicking focuses the
 * window, which promotes it into the live set.
 */
export function CanvasTerminalPlaceholder({
	window,
	connectionHint,
}: {
	window: CanvasWindow;
	connectionHint?: string;
}) {
	const data = window.data as CanvasTerminalData;
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background/60">
			<TerminalSquare className="size-8 text-muted-foreground/40" />
			<span className="max-w-[80%] truncate text-xs text-muted-foreground">
				{data.title?.trim() || "Terminal"}
			</span>
			{connectionHint ? (
				<span className="text-[10px] text-muted-foreground/60">
					{connectionHint}
				</span>
			) : null}
		</div>
	);
}
