import { db } from "@superset/db/client";
import { apikeys, members } from "@superset/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure } from "../../trpc";

export const apiKeyRouter = {
	// Reference-data read replacing the Electric `auth.apikeys` shape. Returns
	// only display columns — never the secret `key`/token.
	list: protectedProcedure
		.input(z.object({ organizationId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const membership = await db.query.members.findFirst({
				where: and(
					eq(members.userId, ctx.session.user.id),
					eq(members.organizationId, input.organizationId),
				),
			});
			if (!membership) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Not a member of organization ${input.organizationId}`,
				});
			}

			return db
				.select({
					id: apikeys.id,
					name: apikeys.name,
					start: apikeys.start,
					createdAt: apikeys.createdAt,
					lastRequest: apikeys.lastRequest,
				})
				.from(apikeys)
				.where(eq(apikeys.organizationId, input.organizationId));
		}),

	create: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = ctx.activeOrganizationId;
			if (!organizationId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Active organization required to create an API key",
				});
			}

			const result = await ctx.auth.api.createApiKey({
				headers: ctx.headers,
				body: {
					name: input.name,
					metadata: { organizationId },
				},
			});

			return { key: result.key };
		}),
};
