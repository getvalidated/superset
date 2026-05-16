import { mintUserJwt } from "@superset/auth/server";
import { dbWs } from "@superset/db/client";
import {
	users,
	v2Hosts,
	v2UsersHosts,
	v2Workspaces,
} from "@superset/db/schema";
import { buildHostRoutingKey } from "@superset/shared/host-routing";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../env";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { relayMutation, relayQuery } from "../automation/relay-client";
import { requireActiveOrgMembership } from "../utils/active-org";

interface HostTerminalSummary {
	terminalId: string;
	workspaceId: string;
	createdAt: Date;
	exited: boolean;
	exitCode: number | null;
	attached: boolean;
	title: string | null;
}

const workspaceInput = z.object({ workspaceId: z.string().uuid() });

async function requireWorkspaceHost(
	workspaceId: string,
	organizationId: string,
	userId: string,
) {
	const workspace = await dbWs.query.v2Workspaces.findFirst({
		where: and(
			eq(v2Workspaces.id, workspaceId),
			eq(v2Workspaces.organizationId, organizationId),
		),
	});
	if (!workspace) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Workspace not found in this organization",
		});
	}
	const host = await dbWs.query.v2Hosts.findFirst({
		where: and(
			eq(v2Hosts.organizationId, organizationId),
			eq(v2Hosts.machineId, workspace.hostId),
		),
	});
	if (!host) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Host record missing for workspace",
		});
	}
	const membership = await dbWs.query.v2UsersHosts.findFirst({
		where: and(
			eq(v2UsersHosts.organizationId, organizationId),
			eq(v2UsersHosts.userId, userId),
			eq(v2UsersHosts.hostId, host.machineId),
		),
	});
	if (!membership) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You are not a member of this host",
		});
	}
	return host;
}

async function mintRelayJwt(userId: string, organizationId: string) {
	const [owner] = await dbWs
		.select({ email: users.email })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	return mintUserJwt({
		userId,
		email: owner?.email,
		organizationIds: [organizationId],
		scope: "remote-control",
		ttlSeconds: 300,
	});
}

export const workspaceTerminalRouter = createTRPCRouter({
	list: protectedProcedure
		.input(workspaceInput)
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const userId = ctx.session.user.id;
			const host = await requireWorkspaceHost(
				input.workspaceId,
				organizationId,
				userId,
			);
			const jwt = await mintRelayJwt(userId, organizationId);
			const routingKey = buildHostRoutingKey(organizationId, host.machineId);
			const result = await relayQuery<
				{ workspaceId: string },
				{ sessions: HostTerminalSummary[] }
			>(
				{ relayUrl: env.RELAY_URL, hostId: routingKey, jwt, timeoutMs: 5000 },
				"terminal.listSessions",
				{ workspaceId: input.workspaceId },
			);
			return result.sessions;
		}),

	create: protectedProcedure
		.input(workspaceInput)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const userId = ctx.session.user.id;
			const host = await requireWorkspaceHost(
				input.workspaceId,
				organizationId,
				userId,
			);
			const jwt = await mintRelayJwt(userId, organizationId);
			const routingKey = buildHostRoutingKey(organizationId, host.machineId);
			return relayMutation<
				{ workspaceId: string },
				{ terminalId: string; status: "active" }
			>(
				{ relayUrl: env.RELAY_URL, hostId: routingKey, jwt, timeoutMs: 5000 },
				"terminal.createSession",
				{ workspaceId: input.workspaceId },
			);
		}),

	connection: protectedProcedure
		.input(workspaceInput)
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const userId = ctx.session.user.id;
			const host = await requireWorkspaceHost(
				input.workspaceId,
				organizationId,
				userId,
			);
			const routingKey = buildHostRoutingKey(organizationId, host.machineId);
			const wsBase = env.RELAY_URL.replace(/^http/, "ws").replace(/\/$/, "");
			return { wsUrl: `${wsBase}/hosts/${routingKey}/terminal` };
		}),
});
