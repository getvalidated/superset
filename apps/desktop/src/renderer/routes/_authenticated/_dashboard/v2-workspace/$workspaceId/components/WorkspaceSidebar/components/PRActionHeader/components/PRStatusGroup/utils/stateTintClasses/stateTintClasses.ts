import type { PRState } from "renderer/screens/main/components/PRIcon";

export interface PRStateTint {
	container: string;
	hover: string;
	divider: string;
}

/**
 * State-tinted styling for the PR badge bordered group. Mirrors the
 * PRIcon color palette so the whole group reads as "open"/"draft"/etc.
 * at a glance, not just the icon.
 *
 * Extracted from PRStatusGroup so the unified PR action pill can apply
 * the same tints when it hosts the badge inline.
 */
export function stateTintClasses(state: PRState): PRStateTint {
	switch (state) {
		case "open":
			return {
				container: "border-emerald-500/30 bg-emerald-500/10",
				hover: "hover:bg-emerald-500/15 focus-visible:bg-emerald-500/15",
				divider: "bg-emerald-500/30",
			};
		case "merged":
			return {
				container: "border-violet-500/30 bg-violet-500/10",
				hover: "hover:bg-violet-500/15 focus-visible:bg-violet-500/15",
				divider: "bg-violet-500/30",
			};
		case "closed":
			return {
				container: "border-rose-500/30 bg-rose-500/10",
				hover: "hover:bg-rose-500/15 focus-visible:bg-rose-500/15",
				divider: "bg-rose-500/30",
			};
		case "draft":
			return {
				container: "border-border bg-muted/40",
				hover: "hover:bg-muted/60 focus-visible:bg-muted/60",
				divider: "bg-border",
			};
	}
}
