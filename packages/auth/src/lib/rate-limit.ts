import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "../env";

// 10 invitations per hour per user
export const invitationRateLimit =
	env.KV_REST_API_URL && env.KV_REST_API_TOKEN
		? new Ratelimit({
				redis: new Redis({
					url: env.KV_REST_API_URL,
					token: env.KV_REST_API_TOKEN,
				}),
				limiter: Ratelimit.slidingWindow(10, "1 h"),
				prefix: "ratelimit:invitation",
			})
		: null;
