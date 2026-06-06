import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@superset/ui/hover-card";
import { cn } from "@superset/ui/utils";
import { PRIcon, type PRState } from "renderer/screens/main/components/PRIcon";
import type { ChecksRollup } from "../../../../utils/computeChecksStatus";
import type { PullRequest } from "../../../../utils/getPRFlowState";
import { PRDetailCard } from "../PRDetailCard";
import { PRStatusIndicators } from "../PRStatusIndicators";

interface PRBadgeLinkProps {
	pr: PullRequest;
	checks: ChecksRollup;
	linkState: PRState;
	/** Tailwind class applied on hover/focus so the link's hover tint can
	 *  match the container that hosts it (state-tinted pill, neutral pill,
	 *  etc.). */
	hoverClassName: string;
}

/**
 * The PR badge — state-tinted icon, `#N`, optional check/review
 * indicators, and a rich hover card. Borderless on its own; consumers
 * wrap it in whichever container provides the visual frame.
 *
 * Extracted from `PRStatusGroup` so the unified PR action pill can host
 * it inline alongside the agent dispatch button.
 */
export function PRBadgeLink({
	pr,
	checks,
	linkState,
	hoverClassName,
}: PRBadgeLinkProps) {
	const showIndicators = pr.state === "open"; // includes draft
	return (
		<HoverCard openDelay={150} closeDelay={120}>
			<HoverCardTrigger asChild>
				<a
					href={pr.url}
					target="_blank"
					rel="noopener noreferrer"
					className={cn(
						"flex items-center gap-1 px-1.5 py-0.5 outline-none transition-colors",
						hoverClassName,
					)}
				>
					<PRIcon state={linkState} className="size-4" />
					<span className="font-mono text-xs text-muted-foreground">
						#{pr.number}
					</span>
					{showIndicators && <PRStatusIndicators checks={checks} />}
				</a>
			</HoverCardTrigger>
			<HoverCardContent
				align="end"
				sideOffset={8}
				className="w-80 overflow-hidden p-0"
			>
				<PRDetailCard pr={pr} checks={checks} linkState={linkState} />
			</HoverCardContent>
		</HoverCard>
	);
}
