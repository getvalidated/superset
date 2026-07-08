import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --- Electron mock ---------------------------------------------------------
// The network logger records the `persist:superset` session via Chromium's
// netLog. We mock the Electron `session`/`app` surface so we can observe
// exactly how (and whether) logging is started.

let userDataDir = "";

type StartLoggingOptions = { captureMode?: string; maxFileSize?: number };
const startLoggingCalls: Array<{
	path: string;
	options?: StartLoggingOptions;
}> = [];
let _stopLoggingCalls = 0;

const netLog = {
	startLogging: mock(async (logPath: string, options?: StartLoggingOptions) => {
		startLoggingCalls.push({ path: logPath, options });
	}),
	stopLogging: mock(async () => {
		_stopLoggingCalls += 1;
	}),
};

mock.module("electron", () => ({
	app: {
		getPath: (name: string) => {
			if (name === "userData") return userDataDir;
			return os.tmpdir();
		},
	},
	session: {
		fromPartition: () => ({ netLog }),
	},
}));

const { startNetworkLogger, stopNetworkLogger } = await import("./index");

describe("network logger gating", () => {
	beforeEach(() => {
		userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlog-test-"));
		startLoggingCalls.length = 0;
		_stopLoggingCalls = 0;
		netLog.startLogging.mockClear();
		netLog.stopLogging.mockClear();
		delete process.env.SUPERSET_CAPTURE_NETWORK_LOGS;
	});

	afterEach(async () => {
		// Ensure the module-level `started` flag is reset between tests.
		await stopNetworkLogger();
		fs.rmSync(userDataDir, { recursive: true, force: true });
		delete process.env.SUPERSET_CAPTURE_NETWORK_LOGS;
	});

	test("does not capture network traffic unless explicitly opted in", async () => {
		// No env var / setting enabled -> capture must stay off by default.
		await startNetworkLogger();

		expect(startLoggingCalls).toHaveLength(0);
	});

	test("never captures cookies/auth headers ('includeSensitive') by default", async () => {
		// Even when a support flow enables capture, the default level must not
		// include cookies or Authorization headers.
		process.env.SUPERSET_CAPTURE_NETWORK_LOGS = "1";
		await startNetworkLogger();

		expect(startLoggingCalls).toHaveLength(1);
		expect(startLoggingCalls[0]?.options?.captureMode).not.toBe(
			"includeSensitive",
		);
	});

	test("captures cookies/auth headers only when a support flow escalates", async () => {
		process.env.SUPERSET_CAPTURE_NETWORK_LOGS = "sensitive";
		await startNetworkLogger();

		expect(startLoggingCalls).toHaveLength(1);
		expect(startLoggingCalls[0]?.options?.captureMode).toBe("includeSensitive");
	});
});
