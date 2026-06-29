/**
 * CDP smoke test: verifies the integrations data path end-to-end against a
 * running dev build, with no Electric/sync involvement.
 *
 * Usage:
 *   1. Launch the desktop app with remote debugging enabled:
 *        RENDERER_REMOTE_DEBUG_PORT=9222 bun dev
 *   2. Sign in and open Settings -> Integrations (so the poll fires).
 *   3. Run:
 *        bun run apps/desktop/scripts/cdp-smoke-integrations.ts
 *
 * It attaches to the renderer over the Chrome DevTools Protocol and asserts:
 *   - an `integration.list` tRPC response arrives (proves the new query path),
 *   - that response carries NO `accessToken` / `refreshToken` (column masking),
 *   - no `/v1/shape?table=integration_connections` Electric request fires.
 *
 * Exits 0 on PASS, 1 on FAIL/timeout. Dependency-free (Bun WebSocket + fetch).
 */

const PORT = process.env.RENDERER_REMOTE_DEBUG_PORT ?? "9222";
const TIMEOUT_MS = 35_000; // long enough to catch the 30s view-time poll

interface CdpTarget {
	type: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

async function findRendererTarget(): Promise<CdpTarget> {
	const res = await fetch(`http://localhost:${PORT}/json`);
	const targets = (await res.json()) as CdpTarget[];
	const page = targets.find(
		(t) =>
			t.type === "page" &&
			t.webSocketDebuggerUrl &&
			!t.url.startsWith("devtools://"),
	);
	if (!page?.webSocketDebuggerUrl) {
		throw new Error(
			`No renderer page target on :${PORT}. Is the app running with RENDERER_REMOTE_DEBUG_PORT=${PORT}?`,
		);
	}
	return page;
}

function main() {
	findRendererTarget()
		.then((target) => {
			const ws = new WebSocket(target.webSocketDebuggerUrl as string);
			let nextId = 1;
			const send = (method: string, params: Record<string, unknown> = {}) =>
				ws.send(JSON.stringify({ id: nextId++, method, params }));

			let shapeRequestSeen = false;
			let listRequestId: string | null = null;
			const bodyRequestIds = new Map<number, string>();

			const fail = (msg: string) => {
				console.error(`❌ FAIL: ${msg}`);
				ws.close();
				process.exit(1);
			};
			const pass = (msg: string) => {
				console.log(`✅ PASS: ${msg}`);
				ws.close();
				process.exit(0);
			};

			const timer = setTimeout(
				() =>
					fail(
						`no integration.list response within ${TIMEOUT_MS / 1000}s. Open Settings -> Integrations so the poll fires.`,
					),
				TIMEOUT_MS,
			);

			ws.addEventListener("open", () => {
				console.log(`Attached to ${target.url}`);
				send("Network.enable");
			});

			ws.addEventListener("message", (event) => {
				const msg = JSON.parse(event.data as string);

				if (msg.method === "Network.responseReceived") {
					const url: string = msg.params.response.url;
					if (
						url.includes("/v1/shape") &&
						url.includes("integration_connections")
					) {
						shapeRequestSeen = true;
					}
					if (url.includes("integration.list")) {
						listRequestId = msg.params.requestId;
					}
				}

				if (
					msg.method === "Network.loadingFinished" &&
					msg.params.requestId === listRequestId
				) {
					const callId = nextId;
					bodyRequestIds.set(callId, listRequestId);
					send("Network.getResponseBody", { requestId: listRequestId });
				}

				if (msg.id && bodyRequestIds.has(msg.id)) {
					clearTimeout(timer);
					const body: string = msg.result?.body ?? "";
					const leaks =
						body.includes("accessToken") || body.includes("refreshToken");
					const looksRight = body.includes("provider");

					console.log(`  integration.list body bytes: ${body.length}`);
					console.log(`  contains provider: ${looksRight}`);
					console.log(`  contains token fields: ${leaks}`);
					console.log(`  electric shape request seen: ${shapeRequestSeen}`);

					if (leaks)
						return fail(
							"integration.list response contains OAuth token fields",
						);
					if (shapeRequestSeen)
						return fail(
							"an Electric shape request for integration_connections fired",
						);
					if (!looksRight)
						return fail(
							"integration.list body did not look like connection rows",
						);
					pass(
						"integration.list is masked and served via tRPC (no Electric shape)",
					);
				}
			});

			ws.addEventListener("error", (e) =>
				fail(`websocket error: ${(e as ErrorEvent).message ?? e}`),
			);
		})
		.catch((err) => {
			console.error(`❌ FAIL: ${err.message}`);
			process.exit(1);
		});
}

main();
