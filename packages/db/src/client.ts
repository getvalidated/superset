import { neon, Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";

import { env } from "./env";
import { configureLocalProxy, isLocalProxy } from "./local-proxy";
import { redactDbError } from "./redact";
import * as schema from "./schema";

config({ path: ".env", quiet: true });

if (isLocalProxy(env.DATABASE_URL)) {
	configureLocalProxy();
}

/**
 * A brief network blip to Neon over the `neon-http` driver rejects with
 * `TypeError: fetch failed` (wrapped as `NeonDbError`). These are transient and
 * self-healing, so a couple of quick retries usually resolve them before the
 * error bubbles up to Better Auth or tRPC.
 */
function isTransientFetchError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const causeMessage =
		(error as { cause?: unknown }).cause instanceof Error
			? (error.cause as Error).message
			: "";
	const message = `${error.message} ${causeMessage}`;
	return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
		message,
	);
}

/**
 * `neon()` returns a callable query function that Drizzle's neon-http driver
 * invokes and also reads properties from (e.g. `transaction`). We wrap it in a
 * Proxy so those properties/behaviors are preserved, while every query call:
 *  - retries transient `fetch failed` network blips a few times, and
 *  - redacts the Drizzle `params:` dump from any error that still propagates.
 *
 * The redaction matters because on a failed session/JWKS lookup Drizzle rethrows
 * `Failed query: select ... where token = $1\nparams: <token>`, which can leak a
 * live Better Auth session token into the queryable log store. See ./redact.ts.
 */
function withRetryAndRedaction<T extends object>(queryFn: T): T {
	const maxAttempts = 3;
	return new Proxy(queryFn, {
		apply(target, thisArg, argArray) {
			const run = async (): Promise<unknown> => {
				let lastError: unknown;
				for (let attempt = 1; attempt <= maxAttempts; attempt++) {
					try {
						return await Reflect.apply(
							target as (...args: unknown[]) => Promise<unknown>,
							thisArg,
							argArray,
						);
					} catch (error) {
						lastError = error;
						if (attempt < maxAttempts && isTransientFetchError(error)) {
							await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
							continue;
						}
						throw redactDbError(error);
					}
				}
				throw redactDbError(lastError);
			};
			return run();
		},
	});
}

const sql = withRetryAndRedaction(neon(env.DATABASE_URL));

export const db = drizzle({
	client: sql,
	schema,
	casing: "snake_case",
});

export const dbWs = drizzleWs({
	client: new Pool({ connectionString: env.DATABASE_URL }),
	schema,
	casing: "snake_case",
});
