import { createFileRoute } from "@tanstack/react-router";
import { FreeformSessionProvider } from "../providers/FreeformSessionProvider";
import { FreeformSessionContent } from "./components/FreeformSessionContent";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/chat/$sessionId/",
)({
	component: FreeformSessionPage,
});

function FreeformSessionPage() {
	const { sessionId } = Route.useParams();

	return (
		<div className="flex min-h-0 min-w-0 flex-1">
			<FreeformSessionProvider key={sessionId} sessionId={sessionId}>
				<FreeformSessionContent initialChatSessionId={sessionId} />
			</FreeformSessionProvider>
		</div>
	);
}
