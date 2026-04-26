import {
	hostAgentConfigSchema,
	hostAgentPromptInputSchema,
} from "@superset/shared/host-agent-config";
import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hostAgentConfigs } from "../../../db/schema";
import { protectedProcedure, router } from "../../index";

export const agentConfigsRouter = router({
	list: protectedProcedure.query(({ ctx }) => {
		const rows = ctx.db
			.select({
				id: hostAgentConfigs.id,
				presetId: hostAgentConfigs.presetId,
				label: hostAgentConfigs.label,
				launchCommand: hostAgentConfigs.launchCommand,
				promptInput: hostAgentConfigs.promptInput,
				order: hostAgentConfigs.order,
				userModified: hostAgentConfigs.userModified,
			})
			.from(hostAgentConfigs)
			.orderBy(asc(hostAgentConfigs.order))
			.all();
		return rows.map((row) => hostAgentConfigSchema.parse(row));
	}),

	add: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				presetId: z.string().min(1),
				label: z.string().min(1),
				launchCommand: z.string().min(1),
				promptInput: hostAgentPromptInputSchema,
			}),
		)
		.mutation(({ ctx, input }) => {
			const maxRow = ctx.db
				.select({ max: sql<number | null>`max(${hostAgentConfigs.order})` })
				.from(hostAgentConfigs)
				.get();
			const order = (maxRow?.max ?? -1) + 1;
			ctx.db
				.insert(hostAgentConfigs)
				.values({
					id: input.id,
					presetId: input.presetId,
					label: input.label,
					launchCommand: input.launchCommand,
					promptInput: input.promptInput,
					order,
					userModified: true,
				})
				.run();
			return hostAgentConfigSchema.parse({
				...input,
				order,
				userModified: true,
			});
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				patch: z
					.object({
						label: z.string().min(1).optional(),
						launchCommand: z.string().min(1).optional(),
						promptInput: hostAgentPromptInputSchema.optional(),
					})
					.refine((p) => Object.keys(p).length > 0, "patch must not be empty"),
			}),
		)
		.mutation(({ ctx, input }) => {
			const result = ctx.db
				.update(hostAgentConfigs)
				.set({ ...input.patch, userModified: true })
				.where(eq(hostAgentConfigs.id, input.id))
				.run();
			if (result.changes === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Agent config "${input.id}" not found`,
				});
			}
			return { id: input.id };
		}),

	remove: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(({ ctx, input }) => {
			ctx.db.transaction((tx) => {
				tx.delete(hostAgentConfigs)
					.where(eq(hostAgentConfigs.id, input.id))
					.run();
				const remaining = tx
					.select({ id: hostAgentConfigs.id })
					.from(hostAgentConfigs)
					.orderBy(asc(hostAgentConfigs.order))
					.all();
				remaining.forEach((row, index) => {
					tx.update(hostAgentConfigs)
						.set({ order: index })
						.where(eq(hostAgentConfigs.id, row.id))
						.run();
				});
			});
			return { id: input.id };
		}),

	reorder: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
		.mutation(({ ctx, input }) => {
			ctx.db.transaction((tx) => {
				const existing = tx
					.select({ id: hostAgentConfigs.id })
					.from(hostAgentConfigs)
					.all();
				const existingIds = new Set(existing.map((r) => r.id));
				if (existingIds.size !== input.ids.length) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `reorder must include all ${existingIds.size} agent configs (got ${input.ids.length})`,
					});
				}
				for (const id of input.ids) {
					if (!existingIds.has(id)) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `unknown agent config id "${id}"`,
						});
					}
				}
				input.ids.forEach((id, index) => {
					tx.update(hostAgentConfigs)
						.set({ order: index })
						.where(eq(hostAgentConfigs.id, id))
						.run();
				});
			});
			return { ids: input.ids };
		}),
});

export type AgentConfigsRouter = typeof agentConfigsRouter;
