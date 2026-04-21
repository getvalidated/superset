/**
 * Renders the Parts of one assistant message in order. The streaming
 * boundary indicator is drawn by the Timeline row (not here) so this
 * component stays dumb.
 */

import type { AssistantMessage, Part } from "@superset/chat/shared";
import { renderPart } from "../Parts";

export function AssistantParts({
	message,
	parts,
	streaming,
}: {
	message: AssistantMessage;
	parts: Part[];
	streaming: boolean;
}) {
	if (message.error) {
		return (
			<div
				data-message-id={message.id}
				className="text-muted-foreground my-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs dark:border-red-900 dark:bg-red-950/50"
			>
				<div className="mb-1 font-medium text-red-700 dark:text-red-300">
					Assistant error
				</div>
				<div>{message.error.message}</div>
			</div>
		);
	}
	return (
		<div data-message-id={message.id} className="my-2 space-y-1">
			{parts.map((p) => (
				<div key={p.id}>{renderPart(p, message, streaming)}</div>
			))}
		</div>
	);
}
