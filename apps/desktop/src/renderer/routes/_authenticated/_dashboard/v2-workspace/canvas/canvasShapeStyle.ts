/**
 * Style options for drawn canvas shapes (lines, boxes, text notes). Shapes
 * persist a palette *key*, not a raw CSS color, so the palette can evolve and
 * unknown keys degrade to the theme-default color instead of breaking rows.
 */

export interface CanvasShapeColorOption {
	key: string;
	label: string;
	/** CSS color, or null for the theme-default foreground stroke. */
	css: string | null;
}

// Tailwind 500-series hues — legible on both light and dark canvases.
export const CANVAS_SHAPE_COLORS: CanvasShapeColorOption[] = [
	{ key: "default", label: "Default", css: null },
	{ key: "gray", label: "Gray", css: "#9ca3af" },
	{ key: "red", label: "Red", css: "#ef4444" },
	{ key: "orange", label: "Orange", css: "#f97316" },
	{ key: "yellow", label: "Yellow", css: "#eab308" },
	{ key: "green", label: "Green", css: "#22c55e" },
	{ key: "blue", label: "Blue", css: "#3b82f6" },
	{ key: "purple", label: "Purple", css: "#a855f7" },
	{ key: "pink", label: "Pink", css: "#ec4899" },
];

/** CSS color for a persisted palette key; null means "use theme default". */
export function resolveCanvasShapeColor(
	key: string | undefined,
): string | null {
	if (!key) return null;
	return CANVAS_SHAPE_COLORS.find((option) => option.key === key)?.css ?? null;
}

/** ~15% alpha tint of a palette color, for box fills. */
export function canvasShapeFillColor(key: string | undefined): string | null {
	const css = resolveCanvasShapeColor(key);
	return css ? `${css}26` : null;
}

export interface CanvasTextSizeOption {
	label: string;
	px: number;
}

export const DEFAULT_CANVAS_TEXT_SIZE_PX = 14;

export const CANVAS_TEXT_SIZES: CanvasTextSizeOption[] = [
	{ label: "Small", px: 12 },
	{ label: "Medium", px: DEFAULT_CANVAS_TEXT_SIZE_PX },
	{ label: "Large", px: 20 },
];
