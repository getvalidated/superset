import { CommandPrimitive } from "@superset/ui/command";
import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FileResultItem } from "renderer/screens/main/components/CommandPalette/components/FileResultItem";
import { useV2FileSearch } from "renderer/screens/main/components/CommandPalette/hooks/useV2FileSearch";
import type { CanvasSearchData } from "../openCanvasWindow";

/**
 * Embedded file-search window for the canvas — the CommandPalette's v2
 * search without the dialog chrome. Must render under a workspace-client
 * provider (CanvasHostProvider) for the search query to route to the
 * owning workspace's host.
 */
export function CanvasSearchPane({
	workspaceId,
	data,
	onDataChange,
	onSelectFile,
}: {
	workspaceId: string;
	data: CanvasSearchData;
	onDataChange: (data: CanvasSearchData) => void;
	onSelectFile: (absolutePath: string) => void;
}) {
	// Local state is authoritative while typing; data.query only seeds the
	// initial value so the persisted-store roundtrip can't clobber input.
	const [query, setQuery] = useState(data.query ?? "");
	const inputRef = useRef<HTMLInputElement>(null);

	// useV2FileSearch results carry absolute paths (result.path =
	// match.absolutePath), so picks pass through unresolved.
	const { results, isFetching } = useV2FileSearch(workspaceId, query);
	const hasQuery = query.trim().length > 0;

	useEffect(() => {
		requestAnimationFrame(() => inputRef.current?.focus());
	}, []);

	const handleQueryChange = (value: string) => {
		setQuery(value);
		onDataChange({ ...data, query: value });
	};

	return (
		<CommandPrimitive
			shouldFilter={false}
			className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground"
		>
			<div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
				<SearchIcon className="size-4 shrink-0 opacity-50" />
				<CommandPrimitive.Input
					ref={inputRef}
					placeholder="Search files..."
					value={query}
					onValueChange={handleQueryChange}
					className="flex h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				/>
			</div>
			<CommandPrimitive.List className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto scroll-py-1 p-1">
				{!hasQuery ? (
					<div className="py-6 text-center text-sm text-muted-foreground">
						Type to search files
					</div>
				) : (
					<>
						{!isFetching && (
							<CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
								No files found.
							</CommandPrimitive.Empty>
						)}
						{results.map((file) => (
							<FileResultItem
								key={file.id}
								value={file.path}
								fileName={file.name}
								relativePath={file.relativePath}
								onSelect={() => onSelectFile(file.path)}
							/>
						))}
					</>
				)}
			</CommandPrimitive.List>
		</CommandPrimitive>
	);
}
