import {
	DropdownMenuItem,
	DropdownMenuLabel,
} from "@superset/ui/dropdown-menu";
import { VscGitMerge } from "react-icons/vsc";
import type { MergeMethod } from "../../hooks/useMergePR";

interface MergePRMenuItemsProps {
	onMerge: (method: MergeMethod) => void;
	isPending: boolean;
}

/** Three merge-strategy items, rendered as plain DropdownMenu children
 *  so callers can splice them into any dropdown. Extracted from
 *  PRStatusGroup so the unified PR action pill can host the same items
 *  inside its combined chevron menu. */
export function MergePRMenuItems({
	onMerge,
	isPending,
}: MergePRMenuItemsProps) {
	return (
		<>
			<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
				Merge
			</DropdownMenuLabel>
			<DropdownMenuItem
				onClick={() => onMerge("squash")}
				className="text-xs"
				disabled={isPending}
			>
				<VscGitMerge className="size-3.5" />
				Squash and merge
			</DropdownMenuItem>
			<DropdownMenuItem
				onClick={() => onMerge("merge")}
				className="text-xs"
				disabled={isPending}
			>
				<VscGitMerge className="size-3.5" />
				Create merge commit
			</DropdownMenuItem>
			<DropdownMenuItem
				onClick={() => onMerge("rebase")}
				className="text-xs"
				disabled={isPending}
			>
				<VscGitMerge className="size-3.5" />
				Rebase and merge
			</DropdownMenuItem>
		</>
	);
}
