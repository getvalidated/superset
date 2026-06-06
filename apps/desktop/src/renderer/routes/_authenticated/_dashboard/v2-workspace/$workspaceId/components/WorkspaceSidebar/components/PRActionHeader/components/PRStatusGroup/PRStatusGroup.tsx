import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { VscChevronDown, VscLoading } from "react-icons/vsc";
import { computeChecksRollup } from "../../utils/computeChecksStatus";
import type { PRFlowState } from "../../utils/getPRFlowState";
import { MergePRMenuItems } from "./components/MergePRMenuItems";
import { PRBadgeLink } from "./components/PRBadgeLink";
import { useMergePR } from "./hooks/useMergePR";
import { stateTintClasses } from "./utils/stateTintClasses";

interface PRStatusGroupProps {
	state: PRFlowState;
	workspaceId: string;
	onRefresh?: () => void;
}

/**
 * Standalone PR badge pill — link + status indicators + merge dropdown
 * (when open + non-draft). Rendered when there's no agent action to
 * pair with (synced / merged / closed PRs).
 *
 * For the dirty / behind-upstream cases, the action header uses
 * `PRActionSplitButton` with an inline `prBadge` to merge this badge
 * + the agent dispatch into a single bordered pill. The reusable
 * pieces (`PRBadgeLink`, `useMergePR`, `MergePRMenuItems`,
 * `stateTintClasses`) are exported via this folder's `index.ts`.
 */
export function PRStatusGroup({
	state,
	workspaceId,
	onRefresh,
}: PRStatusGroupProps) {
	const pr =
		state.kind === "pr-exists"
			? state.pr
			: state.kind === "busy" || state.kind === "error"
				? state.pr
				: null;

	const checks = useMemo(
		() => (pr ? computeChecksRollup(pr.checks) : null),
		[pr],
	);

	const { handleMerge, isPending } = useMergePR({
		workspaceId,
		pr,
		onRefresh,
	});

	if (!pr || !checks) return null;

	const linkState = pr.isDraft
		? "draft"
		: pr.state === "merged"
			? "merged"
			: pr.state === "closed"
				? "closed"
				: "open";
	const canMerge = pr.state === "open" && !pr.isDraft;
	const tint = stateTintClasses(linkState);

	return (
		<div
			className={cn(
				"flex items-center overflow-hidden rounded border",
				tint.container,
			)}
			aria-busy={isPending}
		>
			<PRBadgeLink
				pr={pr}
				checks={checks}
				linkState={linkState}
				hoverClassName={tint.hover}
			/>
			{canMerge && (
				<>
					<div className={cn("h-full w-px", tint.divider)} />
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className={cn(
									"flex items-center px-1 py-0.5 outline-none transition-colors",
									tint.hover,
								)}
								disabled={isPending}
								aria-label={
									isPending ? "Merging pull request" : "Open merge options"
								}
							>
								{isPending ? (
									<VscLoading className="size-3 animate-spin text-muted-foreground" />
								) : (
									<VscChevronDown className="size-3 text-muted-foreground" />
								)}
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							<MergePRMenuItems onMerge={handleMerge} isPending={isPending} />
						</DropdownMenuContent>
					</DropdownMenu>
				</>
			)}
		</div>
	);
}
