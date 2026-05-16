"use client";

import {
	REMOTE_CONTROL_TOKEN_PARAM,
	type RemoteControlClientMessage,
	type RemoteControlServerMessage,
} from "@superset/shared/remote-control-protocol";
import { FitAddon } from "@xterm/addon-fit";
import type { ITheme } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpcClient } from "../../../../../trpc/client";

const TERMINAL_THEME: ITheme = {
	background: "#151110",
	foreground: "#eae8e6",
	cursor: "#e07850",
	cursorAccent: "#151110",
	selectionBackground: "rgba(224, 120, 80, 0.25)",
	black: "#151110",
	red: "#dc6b6b",
	green: "#7ec699",
	yellow: "#e5c07b",
	blue: "#61afef",
	magenta: "#c678dd",
	cyan: "#56b6c2",
	white: "#eae8e6",
	brightBlack: "#5c5856",
	brightRed: "#e88888",
	brightGreen: "#98d1a8",
	brightYellow: "#ecd08f",
	brightBlue: "#7ec0f5",
	brightMagenta: "#d494e6",
	brightCyan: "#73c7d3",
	brightWhite: "#ffffff",
};

const TERMINAL_FONT_FAMILY =
	'"JetBrains Mono", "MesloLGS NF", "Menlo", "Monaco", "Courier New", monospace';

const KEY_BUTTONS: Array<{ label: string; sequence: string }> = [
	{ label: "Tab", sequence: "\t" },
	{ label: "Esc", sequence: "\x1b" },
	{ label: "Ctrl-C", sequence: "\x03" },
	{ label: "Ctrl-D", sequence: "\x04" },
	{ label: "↑", sequence: "\x1b[A" },
	{ label: "↓", sequence: "\x1b[B" },
	{ label: "←", sequence: "\x1b[D" },
	{ label: "→", sequence: "\x1b[C" },
];

interface WebTerminalProps {
	workspaceId: string;
	terminalId: string;
}

type ConnectionState = "connecting" | "open" | "error" | "exited";

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

export function WebTerminal({ workspaceId, terminalId }: WebTerminalProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const [state, setState] = useState<ConnectionState>("connecting");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const sendClientMessage = useCallback(
		(message: RemoteControlClientMessage) => {
			const socket = wsRef.current;
			if (!socket || socket.readyState !== WebSocket.OPEN) return;
			socket.send(JSON.stringify(message));
		},
		[],
	);

	const sendSequence = useCallback(
		(sequence: string) => {
			sendClientMessage({
				type: "input",
				data: bytesToBase64(new TextEncoder().encode(sequence)),
			});
		},
		[sendClientMessage],
	);

	useEffect(() => {
		let cancelled = false;
		let terminal: Terminal | null = null;
		let fitAddon: FitAddon | null = null;
		let socket: WebSocket | null = null;
		let resizeObserver: ResizeObserver | null = null;
		let pingTimer: ReturnType<typeof setInterval> | null = null;
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		const visualViewport = window.visualViewport;

		// Refit on every layout change but trailing-debounce the host
		// broadcast — the soft keyboard resizes the visual viewport rather
		// than the layout viewport, so the visualViewport listeners are what
		// keep the prompt above the keyboard on mobile.
		const refit = () => {
			if (!fitAddon || !terminal) return;
			try {
				fitAddon.fit();
			} catch {
				return;
			}
			const { cols, rows } = terminal;
			if (resizeTimer !== null) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				resizeTimer = null;
				sendClientMessage({ type: "resize", cols, rows });
			}, 200);
		};

		(async () => {
			try {
				const session = await trpcClient.remoteControl.create.mutate({
					workspaceId,
					terminalId,
					mode: "full",
				});
				if (cancelled) return;
				if (!session.wsUrl) {
					setErrorMessage("Host did not return a terminal endpoint.");
					setState("error");
					return;
				}
				const container = containerRef.current;
				if (!container) return;

				terminal = new Terminal({
					cursorBlink: true,
					cursorStyle: "block",
					fontFamily: TERMINAL_FONT_FAMILY,
					fontSize: 14,
					scrollback: 5000,
					theme: TERMINAL_THEME,
					allowProposedApi: true,
				});
				fitAddon = new FitAddon();
				terminal.loadAddon(fitAddon);
				terminal.open(container);
				try {
					fitAddon.fit();
				} catch {
					// container may not be sized yet
				}

				socket = new WebSocket(
					`${session.wsUrl}?${REMOTE_CONTROL_TOKEN_PARAM}=${encodeURIComponent(session.token)}`,
				);
				wsRef.current = socket;

				socket.onopen = () => {
					setState("open");
					pingTimer = setInterval(() => {
						sendClientMessage({ type: "ping" });
					}, 25_000);
				};

				socket.onmessage = (event) => {
					let message: RemoteControlServerMessage;
					try {
						message = JSON.parse(
							String(event.data),
						) as RemoteControlServerMessage;
					} catch {
						return;
					}
					switch (message.type) {
						case "hello":
							try {
								terminal?.resize(message.cols, message.rows);
							} catch {
								// best-effort
							}
							return;
						case "snapshot":
						case "data":
							terminal?.write(base64ToBytes(message.data));
							return;
						case "exit":
							terminal?.write(
								`\r\n\x1b[33m[process exited code=${message.exitCode}]\x1b[0m\r\n`,
							);
							setState("exited");
							return;
						case "revoked":
							setState("exited");
							return;
						case "error":
							setErrorMessage(`${message.code}: ${message.message}`);
							return;
						default:
							return;
					}
				};

				socket.onclose = () => {
					if (pingTimer) {
						clearInterval(pingTimer);
						pingTimer = null;
					}
					setState((previous) =>
						previous === "open" || previous === "connecting"
							? "error"
							: previous,
					);
				};

				socket.onerror = () => {
					setErrorMessage("WebSocket connection failed.");
				};

				terminal.onData((data) => {
					sendClientMessage({
						type: "input",
						data: bytesToBase64(new TextEncoder().encode(data)),
					});
				});

				resizeObserver = new ResizeObserver(refit);
				resizeObserver.observe(container);
				visualViewport?.addEventListener("resize", refit);
				visualViewport?.addEventListener("scroll", refit);
			} catch (caught) {
				if (cancelled) return;
				setErrorMessage(
					caught instanceof Error ? caught.message : String(caught),
				);
				setState("error");
			}
		})();

		return () => {
			cancelled = true;
			if (resizeTimer !== null) clearTimeout(resizeTimer);
			if (pingTimer) clearInterval(pingTimer);
			resizeObserver?.disconnect();
			visualViewport?.removeEventListener("resize", refit);
			visualViewport?.removeEventListener("scroll", refit);
			try {
				socket?.close();
			} catch {
				// best-effort
			}
			terminal?.dispose();
			wsRef.current = null;
		};
	}, [workspaceId, terminalId, sendClientMessage]);

	return (
		<div className="flex h-full flex-col">
			<div className="relative flex-1 overflow-hidden">
				<div ref={containerRef} className="absolute inset-0" />
				{state !== "open" && (
					<div
						className="absolute inset-x-0 top-0 px-3 py-1 text-xs"
						style={{ color: "#ecd08f" }}
					>
						{state === "connecting"
							? "Connecting…"
							: state === "exited"
								? "Process exited."
								: (errorMessage ?? "Disconnected.")}
					</div>
				)}
			</div>
			<div
				className="flex flex-wrap gap-1 border-t p-1"
				style={{ borderColor: "#2a2827", backgroundColor: "#1a1716" }}
			>
				{KEY_BUTTONS.map((button) => (
					<button
						key={button.label}
						type="button"
						onClick={() => sendSequence(button.sequence)}
						className="rounded border px-2 py-1 text-xs"
						style={{ borderColor: "#2a2827", color: "#eae8e6" }}
					>
						{button.label}
					</button>
				))}
			</div>
		</div>
	);
}
