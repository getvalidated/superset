import { electronTrpcClient } from "./trpc-client";

/**
 * Renderer-side feeder for the local telemetry store: batches events and
 * hands them to the main process, which appends them as JSONL under
 * <userData>/telemetry/. Fire-and-forget — telemetry mirroring must never
 * surface errors into product code.
 */

const FLUSH_AFTER_MS = 2000;
const FLUSH_AT_COUNT = 50;

const buffers = new Map<string, Record<string, unknown>[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let loggedStoreDir = false;

function flush(): void {
	flushTimer = null;
	for (const [source, events] of buffers) {
		if (events.length === 0) continue;
		buffers.set(source, []);
		electronTrpcClient.analytics.recordLocalEvents
			.mutate({ source, events })
			.then(({ dir }) => {
				if (!loggedStoreDir) {
					loggedStoreDir = true;
					console.info(`[local-telemetry] mirroring events to ${dir}`);
				}
			})
			.catch(() => {
				// Dropped batch — acceptable for a debug mirror.
			});
	}
}

export function recordLocalTelemetry(
	source: string,
	event: Record<string, unknown>,
): void {
	const buffer = buffers.get(source) ?? [];
	buffer.push(event);
	buffers.set(source, buffer);
	if (buffer.length >= FLUSH_AT_COUNT) {
		if (flushTimer) clearTimeout(flushTimer);
		flush();
	} else if (!flushTimer) {
		flushTimer = setTimeout(flush, FLUSH_AFTER_MS);
	}
}
