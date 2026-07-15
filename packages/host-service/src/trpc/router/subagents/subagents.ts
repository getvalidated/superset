import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	listSubagentTranscripts,
	readSubagentTranscript,
} from "../../../subagents";
import { protectedProcedure, router } from "../../index";

// Path-segment ids (session dir + transcript filename) — the charset both
// rejects traversal and matches what Claude Code actually emits.
const pathSegmentIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const subagentsRouter = router({
	/**
	 * Every subagent transcript spawned by a live Claude terminal session on
	 * this host, tagged with the owning terminal/workspace. Org-wide like
	 * terminal.listAllSessions — the global canvas seeds windows from it.
	 * Hosts without ~/.claude simply contribute nothing.
	 */
	listAll: protectedProcedure.query(({ ctx }) => {
		const subagents = [];
		for (const binding of ctx.terminalAgentStore.list()) {
			if (binding.agentId !== "claude" || !binding.agentSessionId) continue;
			for (const transcript of listSubagentTranscripts(
				binding.agentSessionId,
			)) {
				subagents.push({
					terminalId: binding.terminalId,
					workspaceId: binding.workspaceId,
					agentSessionId: binding.agentSessionId,
					...transcript,
				});
			}
		}
		return { subagents };
	}),

	/**
	 * Incremental tail of one subagent transcript. Returns only fully-written
	 * lines from `offsetBytes`; callers resume at `nextOffsetBytes`.
	 */
	readTranscript: protectedProcedure
		.input(
			z.object({
				agentSessionId: pathSegmentIdSchema,
				subagentId: pathSegmentIdSchema,
				offsetBytes: z.number().int().min(0).default(0),
			}),
		)
		.query(({ input }) => {
			const slice = readSubagentTranscript(input);
			if (!slice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Subagent transcript not found",
				});
			}
			return slice;
		}),
});
