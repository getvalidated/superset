// End-to-end integration test for pty-daemon.
//
// Runs under Node (`node --experimental-strip-types --test`), not Bun, because
// node-pty's master fd handling depends on Node's tty.ReadStream behavior.
//
// Spawns a daemon in-process, connects a TCP-style client to its Unix socket,
// runs through the protocol: hello → open → subscribe(replay) → input →
// receive output → close → exit.

import { strict as assert } from "node:assert";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import {
	encodeFrame,
	FrameDecoder,
	type ServerMessage,
} from "../src/protocol/index.ts";
import { Server } from "../src/Server/index.ts";

const sockPath = path.join(os.tmpdir(), `pty-daemon-test-${process.pid}.sock`);
let server: Server;

before(async () => {
	server = new Server({ socketPath: sockPath, daemonVersion: "0.0.0-test" });
	await server.listen();
});

after(async () => {
	await server.close();
});

interface Client {
	socket: net.Socket;
	messages: ServerMessage[];
	waitFor: (
		predicate: (m: ServerMessage) => boolean,
		ms?: number,
	) => Promise<ServerMessage>;
	send: (m: unknown) => void;
	close: () => Promise<void>;
}

function connect(): Promise<Client> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ path: sockPath });
		const decoder = new FrameDecoder();
		const messages: ServerMessage[] = [];
		const waiters: Array<{
			predicate: (m: ServerMessage) => boolean;
			resolve: (m: ServerMessage) => void;
			reject: (e: Error) => void;
			timer: NodeJS.Timeout;
		}> = [];

		socket.on("data", (chunk) => {
			decoder.push(chunk);
			for (const raw of decoder.drain()) {
				const m = raw as ServerMessage;
				messages.push(m);
				for (let i = waiters.length - 1; i >= 0; i--) {
					const w = waiters[i];
					if (w?.predicate(m)) {
						clearTimeout(w.timer);
						waiters.splice(i, 1);
						w.resolve(m);
					}
				}
			}
		});

		socket.once("error", reject);
		socket.once("connect", () =>
			resolve({
				socket,
				messages,
				waitFor(predicate, ms = 5000) {
					return new Promise<ServerMessage>((res, rej) => {
						const found = messages.find(predicate);
						if (found) return res(found);
						const timer = setTimeout(() => {
							rej(new Error(`waitFor timed out after ${ms}ms`));
						}, ms);
						waiters.push({ predicate, resolve: res, reject: rej, timer });
					});
				},
				send(m) {
					socket.write(encodeFrame(m));
				},
				close() {
					return new Promise((res) => {
						socket.end(() => res());
					});
				},
			}),
		);
	});
}

test("handshake: hello → hello-ack", async () => {
	const c = await connect();
	c.send({ type: "hello", protocols: [1] });
	const ack = await c.waitFor((m) => m.type === "hello-ack");
	assert.equal(ack.type, "hello-ack");
	if (ack.type === "hello-ack") {
		assert.equal(ack.protocol, 1);
		assert.equal(ack.daemonVersion, "0.0.0-test");
	}
	await c.close();
});

test("incompatible protocol → error and disconnect", async () => {
	const c = await connect();
	c.send({ type: "hello", protocols: [99] });
	const err = await c.waitFor((m) => m.type === "error");
	assert.equal(err.type, "error");
	if (err.type === "error") assert.equal(err.code, "EVERSION");
	await c.close();
});

test("open → subscribe → output → close lifecycle (real shell)", async () => {
	const c = await connect();
	c.send({ type: "hello", protocols: [1] });
	await c.waitFor((m) => m.type === "hello-ack");

	c.send({
		type: "open",
		id: "s0",
		meta: {
			shell: "/bin/sh",
			argv: ["-c", "echo daemon-integration; sleep 0.2"],
			cols: 80,
			rows: 24,
		},
	});
	const opened = await c.waitFor((m) => m.type === "open-ok");
	assert.equal(opened.type, "open-ok");

	c.send({ type: "subscribe", id: "s0", replay: true });

	const output = await c.waitFor(
		(m) =>
			m.type === "output" &&
			m.id === "s0" &&
			Buffer.from(m.data, "base64").toString().includes("daemon-integration"),
		3000,
	);
	assert.ok(output.type === "output");

	const exit = await c.waitFor((m) => m.type === "exit" && m.id === "s0", 3000);
	assert.equal(exit.type, "exit");
	if (exit.type === "exit") assert.equal(exit.code, 0);

	await c.close();
});

test("input is forwarded to the shell and echoed back via output", async () => {
	const c = await connect();
	c.send({ type: "hello", protocols: [1] });
	await c.waitFor((m) => m.type === "hello-ack");
	c.send({
		type: "open",
		id: "s1",
		meta: { shell: "/bin/sh", argv: ["-i"], cols: 80, rows: 24 },
	});
	await c.waitFor((m) => m.type === "open-ok");
	c.send({ type: "subscribe", id: "s1", replay: false });

	// Send "echo abc-marker\n" — shell echoes the typed bytes back through the
	// PTY (canonical mode), AND prints "abc-marker" as the command output.
	c.send({
		type: "input",
		id: "s1",
		data: Buffer.from("echo abc-marker\n").toString("base64"),
	});

	await c.waitFor(
		(m) =>
			m.type === "output" &&
			m.id === "s1" &&
			Buffer.from(m.data, "base64").toString().includes("abc-marker"),
		3000,
	);

	c.send({ type: "close", id: "s1", signal: "SIGTERM" });
	await c.waitFor((m) => m.type === "closed" && m.id === "s1");
	await c.close();
});

test("subscribe with replay sends prior buffered output", async () => {
	const c = await connect();
	c.send({ type: "hello", protocols: [1] });
	await c.waitFor((m) => m.type === "hello-ack");

	c.send({
		type: "open",
		id: "s2",
		meta: {
			shell: "/bin/sh",
			argv: ["-c", "echo replay-test; sleep 1"],
			cols: 80,
			rows: 24,
		},
	});
	await c.waitFor((m) => m.type === "open-ok");

	// Wait a bit so the shell emits its initial output into the daemon's buffer
	// without any subscriber yet.
	await new Promise((resolve) => setTimeout(resolve, 200));

	c.send({ type: "subscribe", id: "s2", replay: true });
	const out = await c.waitFor(
		(m) =>
			m.type === "output" &&
			m.id === "s2" &&
			Buffer.from(m.data, "base64").toString().includes("replay-test"),
		2000,
	);
	assert.ok(out.type === "output");

	c.send({ type: "close", id: "s2", signal: "SIGTERM" });
	await c.close();
});

test("list returns active sessions", async () => {
	const c = await connect();
	c.send({ type: "hello", protocols: [1] });
	await c.waitFor((m) => m.type === "hello-ack");

	c.send({
		type: "open",
		id: "list-a",
		meta: { shell: "/bin/sh", argv: ["-c", "sleep 5"], cols: 80, rows: 24 },
	});
	await c.waitFor((m) => m.type === "open-ok" && m.id === "list-a");

	c.send({ type: "list" });
	const list = await c.waitFor((m) => m.type === "list-reply");
	assert.equal(list.type, "list-reply");
	if (list.type === "list-reply") {
		assert.ok(list.sessions.some((s) => s.id === "list-a"));
	}

	c.send({ type: "close", id: "list-a", signal: "SIGTERM" });
	await c.waitFor((m) => m.type === "closed");
	await c.close();
});
