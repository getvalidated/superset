import { FileUp } from "lucide-react";

interface FilesTabDropOverlayProps {
	/** Destination folder name shown to the user (e.g. "src" or "workspace root"). */
	label: string;
}

/**
 * Drop affordance shown while OS files are dragged over the Files tab. Renders
 * as a non-interactive overlay so it never swallows the underlying drag events;
 * `label` tracks the folder currently under the cursor.
 */
export function FilesTabDropOverlay({ label }: FilesTabDropOverlayProps) {
	return (
		<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-1.5">
			<div className="flex h-full w-full items-center justify-center rounded-md border-2 border-dashed border-primary/60 bg-primary/5 backdrop-blur-[1px]">
				<div className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-primary">
					<FileUp className="size-4" />
					<span className="text-xs font-medium">Copy into {label}</span>
				</div>
			</div>
		</div>
	);
}
