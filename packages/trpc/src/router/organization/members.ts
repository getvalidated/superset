import { db } from "@superset/db/client";
import { members, users } from "@superset/db/schema";
import { canRemoveMember, type OrganizationRole } from "@superset/shared/auth";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../trpc";
import { verifyOrgAdmin } from "../integration/utils";
import { requireActiveOrgMembership } from "../utils/active-org";

export const organizationMembersRouter = {
	list: protectedProcedure
		.input(
			z
				.object({
					search: z.string().min(1).nullish(),
					limit: z.number().int().positive().max(100).default(50),
				})
				.nullish(),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const conditions = [eq(members.organizationId, organizationId)];
			if (input?.search) {
				const pattern = `%${input.search}%`;
				const match = or(
					ilike(users.name, pattern),
					ilike(users.email, pattern),
				);
				if (match) conditions.push(match);
			}

			return db
				.select({
					id: users.id,
					name: users.name,
					email: users.email,
					image: users.image,
					role: members.role,
				})
				.from(members)
				.innerJoin(users, eq(members.userId, users.id))
				.where(and(...conditions))
				.limit(input?.limit ?? 50);
		}),

	add: protectedProcedure
		.input(
			z.object({
				organizationId: z.string().uuid(),
				userId: z.string().uuid(),
				role: z.enum(["member", "admin", "owner"]).default("member"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyOrgAdmin(ctx.session.user.id, input.organizationId);
			return ctx.auth.api.addMember({
				body: {
					organizationId: input.organizationId,
					userId: input.userId,
					role: input.role,
				},
				headers: ctx.headers,
			});
		}),

	remove: protectedProcedure
		.input(
			z.object({
				organizationId: z.uuid(),
				userId: z.uuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const allMembers = await db.query.members.findMany({
				where: eq(members.organizationId, input.organizationId),
			});

			const targetMember = allMembers.find((m) => m.userId === input.userId);
			if (!targetMember) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found",
				});
			}

			const actorMembership = allMembers.find(
				(m) => m.userId === ctx.session.user.id,
			);
			if (!actorMembership) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not a member of this organization",
				});
			}

			const ownerCount = allMembers.filter((m) => m.role === "owner").length;
			const isTargetSelf = targetMember.userId === ctx.session.user.id;

			const canRemove = canRemoveMember(
				actorMembership.role as OrganizationRole,
				targetMember.role as OrganizationRole,
				isTargetSelf,
				ownerCount,
			);

			if (!canRemove) {
				if (isTargetSelf) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Cannot remove yourself",
					});
				}
				if (targetMember.role === "owner" && ownerCount === 1) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Cannot remove the last owner. Transfer ownership first.",
					});
				}
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You don't have permission to remove this member",
				});
			}

			await ctx.auth.api.removeMember({
				body: {
					organizationId: input.organizationId,
					memberIdOrEmail: targetMember.id,
				},
				headers: ctx.headers,
			});

			return { success: true };
		}),
} satisfies TRPCRouterRecord;
