/**
 * Sanitizes database errors before they propagate to any logger.
 *
 * Drizzle's core query executor rethrows failures with a message shaped like:
 *   `Failed query: select ... where token = $1\nparams: <plaintext-token>`
 * On a transient Neon `fetch failed`, that bound-parameter list can contain a
 * live Better Auth session token, which then lands verbatim in the queryable
 * log store. We strip the `params:` line (and any attached `params` array) so
 * bound values never reach logs, regardless of which caller logs the error.
 */

const PARAMS_LINE = /\n\s*params:.*$/is;

function redactMessage(message: string): string {
	// Drizzle appends the bound params after a "\nparams:" separator. Everything
	// from that separator onward is the sensitive parameter dump.
	return message.replace(PARAMS_LINE, "\nparams: [redacted]");
}

/**
 * Returns a sanitized copy of a thrown DB error with bound query parameters
 * removed. Preserves the error class/name and the non-sensitive prefix of the
 * message (the SQL text and driver error) so debugging context is retained.
 */
export function redactDbError(error: unknown): unknown {
	if (!(error instanceof Error)) {
		return error;
	}

	if (typeof error.message === "string" && error.message.includes("params:")) {
		error.message = redactMessage(error.message);
	}

	// Some drivers expose the bound values on a `params` property as well.
	const withParams = error as Error & { params?: unknown };
	if ("params" in withParams && withParams.params !== undefined) {
		withParams.params = "[redacted]";
	}

	return error;
}

/**
 * Wraps a neon-http query function so that any rejected query has its error
 * sanitized before it propagates. This runs closer to the driver than Drizzle's
 * message construction, but Drizzle attaches params synchronously on the thrown
 * error, so we sanitize on the way out of every await.
 */
export function wrapQueryFn<T extends (...args: never[]) => Promise<unknown>>(
	queryFn: T,
): T {
	const wrapped = async (...args: Parameters<T>) => {
		try {
			return await queryFn(...args);
		} catch (error) {
			throw redactDbError(error);
		}
	};
	return wrapped as T;
}
