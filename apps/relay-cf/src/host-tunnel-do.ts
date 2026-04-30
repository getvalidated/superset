import { setHostOnline } from "./access";
import type {
	Env,
	TunnelHttpResponse,
	TunnelRequest,
	TunnelResponse,
	TunnelWsClose,
	TunnelWsFrame,
} from "./types";

interface HostAttachment {
	type: "host";
	hostId: string;
	token: string;
	generation: number;
	stale?: boolean;
}

interface ClientAttachment {
	type: "client";
	channelId: string;
}

type Attachment = HostAttachment | ClientAttachment;

interface PendingRequest {
	resolve: (response: TunnelHttpResponse) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MISSED = 3;

export class HostTunnel implements DurableObject {
	private hostWs: WebSocket | null = null;
	private hostGeneration = 0;
	private pending = new Map<string, PendingRequest>();
	private clientChannels = new Map<string, WebSocket>();
	private missedPings = 0;
	private pingTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly state: DurableObjectState,
		private readonly env: Env,
	) {
		// Re-derive in-memory state on cold start. Pending HTTP requests cannot
		// survive hibernation (they hold Promise resolvers), but persistent WS
		// connections do, and we rebuild their indexes here.
		for (const ws of this.state.getWebSockets()) {
			const att = ws.deserializeAttachment() as Attachment | undefined;
			if (!att) continue;
			if (att.type === "host" && !att.stale) {
				this.hostWs = ws;
				this.hostGeneration = Math.max(this.hostGeneration, att.generation);
			} else if (att.type === "client") {
				this.clientChannels.set(att.channelId, ws);
			}
		}
		if (this.hostWs) this.startPingTimer();
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/tunnel") {
			return this.registerHost(request, url);
		}

		const subpath = url.pathname.replace(/^\/hosts\/[^/]+/, "") || "/";
		if (request.headers.get("Upgrade") === "websocket") {
			return this.openClientWs(request, subpath, url.search);
		}
		return this.proxyHttp(request, subpath + url.search);
	}

	// ── Host registration ──────────────────────────────────────────────

	private async registerHost(request: Request, url: URL): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const hostId = url.searchParams.get("hostId");
		const token = extractToken(request);
		if (!hostId || !token) {
			return new Response("Missing hostId or token", { status: 400 });
		}

		// Last-write-wins: if a tunnel already exists, mark it stale and close
		// it. The stale flag lets `webSocketClose` skip cleanup of the new
		// tunnel's state when the old socket finishes closing.
		if (this.hostWs) {
			const oldAtt = this.hostWs.deserializeAttachment() as
				| HostAttachment
				| undefined;
			if (oldAtt) {
				this.hostWs.serializeAttachment({ ...oldAtt, stale: true });
			}
			try {
				this.hostWs.close(1000, "replaced");
			} catch {
				// already closed
			}
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		this.hostGeneration++;
		const attachment: HostAttachment = {
			type: "host",
			hostId,
			token,
			generation: this.hostGeneration,
		};

		this.state.acceptWebSocket(server, ["host"]);
		server.serializeAttachment(attachment);

		this.hostWs = server;
		this.missedPings = 0;
		this.startPingTimer();
		console.log(`[relay-cf] tunnel registered: ${hostId}`);

		void setHostOnline(token, hostId, true, this.env.NEXT_PUBLIC_API_URL);

		return new Response(null, {
			status: 101,
			webSocket: client,
		} as ResponseInit);
	}

	// ── Client HTTP → host ────────────────────────────────────────────

	private async proxyHttp(
		request: Request,
		pathWithQuery: string,
	): Promise<Response> {
		if (!this.hostWs) {
			// Drain the request body so the runtime doesn't error trying to flush
			// it after we've already sent the response.
			if (request.body) await request.body.cancel().catch(() => {});
			return new Response('{"error":"Host not connected"}', {
				status: 503,
				headers: { "Content-Type": "application/json" },
			});
		}

		const id = crypto.randomUUID();
		const reqHeaders: Record<string, string> = {};
		request.headers.forEach((value, key) => {
			if (key !== "host" && key !== "authorization") reqHeaders[key] = value;
		});

		const body = request.body
			? await request.text().catch(() => "")
			: undefined;

		const responsePromise = new Promise<TunnelHttpResponse>(
			(resolve, reject) => {
				const timer = setTimeout(() => {
					this.pending.delete(id);
					reject(new Error("Tunnel request timed out"));
				}, REQUEST_TIMEOUT_MS);
				this.pending.set(id, { resolve, reject, timer });
			},
		);

		this.sendToHost({
			type: "http",
			id,
			method: request.method,
			path: pathWithQuery,
			headers: reqHeaders,
			body,
		});

		try {
			const response = await responsePromise;
			return new Response(response.body ?? null, {
				status: response.status,
				headers: response.headers,
			});
		} catch (error) {
			return new Response(
				JSON.stringify({
					error: error instanceof Error ? error.message : "Proxy error",
				}),
				{ status: 502, headers: { "Content-Type": "application/json" } },
			);
		}
	}

	// ── Client WS → host ──────────────────────────────────────────────

	private openClientWs(
		_request: Request,
		subpath: string,
		search: string,
	): Response {
		if (!this.hostWs) {
			return new Response("Host not connected", { status: 503 });
		}

		const channelId = crypto.randomUUID();
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		const attachment: ClientAttachment = { type: "client", channelId };
		this.state.acceptWebSocket(server, ["client"]);
		server.serializeAttachment(attachment);
		this.clientChannels.set(channelId, server);

		const query = search.startsWith("?")
			? search.slice(1)
			: search || undefined;
		this.sendToHost({
			type: "ws:open",
			id: channelId,
			path: subpath,
			query,
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		} as ResponseInit);
	}

	// ── Hibernatable WS callbacks ──────────────────────────────────────

	async webSocketMessage(
		ws: WebSocket,
		raw: string | ArrayBuffer,
	): Promise<void> {
		const att = ws.deserializeAttachment() as Attachment | undefined;
		if (!att) return;

		const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

		if (att.type === "host") {
			if (att.stale) return;
			let msg: TunnelResponse;
			try {
				msg = JSON.parse(text) as TunnelResponse;
			} catch {
				return;
			}
			this.handleHostMessage(msg);
			return;
		}

		// Client WS frame → forward to host as ws:frame.
		this.sendToHost({ type: "ws:frame", id: att.channelId, data: text });
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		_reason: string,
		_wasClean: boolean,
	): Promise<void> {
		const att = ws.deserializeAttachment() as Attachment | undefined;
		if (!att) return;

		if (att.type === "host") {
			if (att.stale) return;
			// Host disconnected: tear down everything bound to it.
			this.hostWs = null;
			this.stopPingTimer();
			for (const pending of this.pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error("Tunnel disconnected"));
			}
			this.pending.clear();
			for (const channel of this.clientChannels.values()) {
				try {
					channel.close(1011, "tunnel disconnected");
				} catch {
					// already closed
				}
			}
			this.clientChannels.clear();
			if (att.token && att.hostId) {
				void setHostOnline(
					att.token,
					att.hostId,
					false,
					this.env.NEXT_PUBLIC_API_URL,
				);
			}
			return;
		}

		// Client channel closed: tell host.
		if (this.clientChannels.get(att.channelId) === ws) {
			this.clientChannels.delete(att.channelId);
		}
		this.sendToHost({ type: "ws:close", id: att.channelId, code });
	}

	async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
		// onclose follows onerror; rely on the close handler to clean up.
		const att = ws.deserializeAttachment() as Attachment | undefined;
		if (att?.type === "client") {
			try {
				ws.close(1011, "client error");
			} catch {
				// already closed
			}
		}
	}

	// ── Internal message dispatch ──────────────────────────────────────

	private handleHostMessage(msg: TunnelResponse): void {
		switch (msg.type) {
			case "pong":
				this.missedPings = 0;
				return;
			case "http:response":
				this.handleResponse(msg);
				return;
			case "ws:frame":
				this.handleWsFrame(msg);
				return;
			case "ws:close":
				this.handleWsCloseFromHost(msg);
				return;
		}
	}

	private handleResponse(msg: TunnelHttpResponse): void {
		const pending = this.pending.get(msg.id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(msg.id);
		pending.resolve(msg);
	}

	private handleWsFrame(msg: TunnelWsFrame): void {
		const channel = this.clientChannels.get(msg.id);
		if (channel?.readyState === WebSocket.READY_STATE_OPEN) {
			channel.send(msg.data);
		}
	}

	private handleWsCloseFromHost(msg: TunnelWsClose): void {
		const channel = this.clientChannels.get(msg.id);
		if (channel) {
			this.clientChannels.delete(msg.id);
			try {
				channel.close(msg.code ?? 1000);
			} catch {
				// already closed
			}
		}
	}

	private sendToHost(msg: TunnelRequest): void {
		if (this.hostWs?.readyState === WebSocket.READY_STATE_OPEN) {
			this.hostWs.send(JSON.stringify(msg));
		}
	}

	// ── Server-side ping (matches the Fly relay's behavior) ────────────

	private startPingTimer(): void {
		this.stopPingTimer();
		this.pingTimer = setInterval(() => {
			if (!this.hostWs) {
				this.stopPingTimer();
				return;
			}
			this.missedPings++;
			if (this.missedPings >= PING_TIMEOUT_MISSED) {
				try {
					this.hostWs.close(1000, "ping timeout");
				} catch {}
				return;
			}
			this.sendToHost({ type: "ping" });
		}, PING_INTERVAL_MS);
	}

	private stopPingTimer(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}
}

function extractToken(req: Request): string | null {
	const header = req.headers.get("Authorization");
	if (header?.startsWith("Bearer ")) return header.slice(7);
	const url = new URL(req.url);
	return url.searchParams.get("token");
}
