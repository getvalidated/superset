/**
 * Minimal Phase 2 reasoning renderer. Collapsible summary + text.
 * Heading extraction + polished Markdown come in Phase 3.
 */

import type { ReasoningPart } from "@superset/chat/shared";
import { useState } from "react";
import type { PartProps } from "./parts";

export function ReasoningPartView({ part }: PartProps<ReasoningPart>) {
	const [expanded, setExpanded] = useState(false);
	if (!part.text) return null;
	return (
		<div className="border-border-weak my-2 rounded-md border px-3 py-2 text-xs">
			<button
				type="button"
				className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between gap-2 text-left"
				onClick={() => setExpanded((v) => !v)}
			>
				<span>Reasoning ({part.text.length} chars)</span>
				<span>{expanded ? "▾" : "▸"}</span>
			</button>
			{expanded && (
				<div className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
					{part.text}
				</div>
			)}
		</div>
	);
}
