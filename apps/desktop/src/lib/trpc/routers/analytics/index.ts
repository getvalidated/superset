import { setUserId } from "main/lib/analytics";
import {
	appendLocalEvents,
	localEventStoreDir,
} from "main/lib/analytics/local-event-store";
import { z } from "zod";
import { publicProcedure, router } from "../..";

export const createAnalyticsRouter = () => {
	return router({
		setUserId: publicProcedure
			.input(z.object({ userId: z.string().nullable() }))
			.mutation(({ input }) => {
				setUserId(input.userId);
			}),
		recordLocalEvents: publicProcedure
			.input(
				z.object({
					source: z.string().max(32),
					events: z.array(z.record(z.string(), z.unknown())).max(500),
				}),
			)
			.mutation(({ input }) => ({
				dir: appendLocalEvents(input.source, input.events),
			})),
		localEventStoreDir: publicProcedure.query(() => localEventStoreDir()),
	});
};

export type AnalyticsRouter = ReturnType<typeof createAnalyticsRouter>;
