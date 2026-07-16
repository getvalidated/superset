import { z } from "zod";
import { protectedProcedure, router } from "../../index";

export interface DesktopBrowserWindow {
	paneId: string;
	title: string;
	url: string;
	isLoading: boolean;
}

const DESKTOP_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Forward a browser-control request to the desktop app's localhost server.
 * The desktop injects its notifications port as SUPERSET_AGENT_HOOK_PORT
 * when it spawns this host-service; headless hosts (CLI-spawned) have no
 * desktop app and therefore no embedded browser to control.
 */
async function desktopBrowserRequest<T>(
	pathname: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const port = process.env.SUPERSET_AGENT_HOOK_PORT;
	if (!port) {
		throw new Error(
			"Browser control is unavailable on this host: no desktop app connection (SUPERSET_AGENT_HOOK_PORT is not set).",
		);
	}

	const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
		method: body ? "POST" : "GET",
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(DESKTOP_REQUEST_TIMEOUT_MS),
	});

	const rawBody = await response.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		throw new Error(
			`Desktop app returned invalid JSON for ${pathname}: ${rawBody.slice(0, 200)}`,
		);
	}

	if (!response.ok) {
		const { error, windows } = parsed as {
			error?: string;
			windows?: DesktopBrowserWindow[];
		};
		const message = error ?? `Desktop app returned ${response.status}`;
		throw new Error(
			windows?.length
				? `${message} Open browser windows: ${JSON.stringify(
						windows.map(({ paneId, title, url }) => ({ paneId, title, url })),
					)}`
				: message,
		);
	}

	return parsed as T;
}

const windowInput = z
	.string()
	.min(1)
	.describe("Browser window identifier: paneId, or a title/URL fragment.");

export const browserRouter = router({
	listWindows: protectedProcedure.query(() =>
		desktopBrowserRequest<{ windows: DesktopBrowserWindow[] }>(
			"/browser/windows",
		),
	),

	screenshot: protectedProcedure
		.input(
			z.object({
				window: windowInput,
				outputPath: z.string().optional(),
			}),
		)
		.mutation(({ input }) =>
			desktopBrowserRequest<{
				paneId: string;
				title: string;
				url: string;
				path: string;
			}>("/browser/screenshot", input),
		),

	reload: protectedProcedure
		.input(
			z.object({
				window: windowInput,
				hard: z.boolean().optional(),
			}),
		)
		.mutation(({ input }) =>
			desktopBrowserRequest<{
				paneId: string;
				title: string;
				url: string;
				reloaded: boolean;
			}>("/browser/reload", input),
		),
});
