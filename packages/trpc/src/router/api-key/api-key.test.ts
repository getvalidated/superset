import { beforeEach, describe, expect, it, mock } from "bun:test";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";

const membersFindFirst = mock(async () => ({ role: "member" }) as unknown);
const selectWhere = mock(async () => [] as unknown[]);
const selectFrom = mock(() => ({ where: selectWhere }));
const selectMock = mock((_cols?: unknown) => ({ from: selectFrom }));

mock.module("@superset/db/client", () => ({
	db: {
		query: { members: { findFirst: membersFindFirst } },
		select: selectMock,
	},
}));

mock.module("@superset/db/schema", () => ({
	apikeys: {
		id: "apikeys.id",
		name: "apikeys.name",
		start: "apikeys.start",
		createdAt: "apikeys.created_at",
		lastRequest: "apikeys.last_request",
		key: "apikeys.key",
		organizationId: "apikeys.organization_id",
	},
	members: {
		userId: "members.user_id",
		organizationId: "members.organization_id",
	},
}));

mock.module("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

const { createCallerFactory, createTRPCRouter } = await import("../../trpc");
const { apiKeyRouter } = await import("./api-key");

const createCaller = createCallerFactory(
	createTRPCRouter({
		apiKey: createTRPCRouter({ list: apiKeyRouter.list }),
	} satisfies TRPCRouterRecord),
);

const ACTOR_USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";

function createContext() {
	return {
		session: {
			user: { id: ACTOR_USER_ID, email: "actor@example.com" },
			session: { activeOrganizationId: ORGANIZATION_ID },
		} as never,
		auth: {} as never,
		headers: new Headers(),
	};
}

describe("apiKey.list", () => {
	beforeEach(() => {
		selectMock.mockReset();
		selectMock.mockImplementation(() => ({ from: selectFrom }));
		selectWhere.mockReset();
		selectWhere.mockImplementation(async () => []);
		membersFindFirst.mockReset();
		membersFindFirst.mockImplementation(async () => ({ role: "member" }));
	});

	it("rejects non-members before reading keys", async () => {
		membersFindFirst.mockImplementationOnce(async () => undefined);
		const caller = createCaller(createContext());

		await expect(
			caller.apiKey.list({ organizationId: ORGANIZATION_ID }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		expect(selectMock).not.toHaveBeenCalled();
	});

	it("scopes the query to the requested organization", async () => {
		const caller = createCaller(createContext());

		await caller.apiKey.list({ organizationId: ORGANIZATION_ID });

		expect(selectWhere.mock.calls[0]?.[0]).toEqual({
			type: "eq",
			left: "apikeys.organization_id",
			right: ORGANIZATION_ID,
		});
	});

	it("never selects the secret key/token column", async () => {
		const caller = createCaller(createContext());

		await caller.apiKey.list({ organizationId: ORGANIZATION_ID });

		const cols = selectMock.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(cols.key).toBeUndefined();
		expect(cols.token).toBeUndefined();
		expect(cols.id).toBe("apikeys.id");
	});

	it("returns the rows the database yields", async () => {
		selectWhere.mockImplementationOnce(async () => [
			{ id: "k1", name: "CI", start: "sk_abc" },
		]);
		const caller = createCaller(createContext());

		const result = await caller.apiKey.list({
			organizationId: ORGANIZATION_ID,
		});

		expect(result).toEqual([{ id: "k1", name: "CI", start: "sk_abc" }]);
	});
});
