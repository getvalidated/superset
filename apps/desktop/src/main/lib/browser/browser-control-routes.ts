import * as fs from "node:fs/promises";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { SUPERSET_HOME_DIR } from "../app-environment";
import { browserManager } from "./browser-manager";

interface BrowserWindowInfo {
	paneId: string;
	title: string;
	url: string;
	isLoading: boolean;
}

type Resolution =
	| { ok: true; window: BrowserWindowInfo }
	| { ok: false; status: number; error: string; windows: BrowserWindowInfo[] };

/**
 * Resolve a human-friendly window identifier to a registered browser pane.
 * Matches an exact paneId first, then a case-insensitive substring of the
 * page title or URL. Ambiguity is an error that carries the candidates so
 * the caller can present them to the user.
 */
function resolveWindow(query: string): Resolution {
	const windows = browserManager.listWindows();
	if (windows.length === 0) {
		return {
			ok: false,
			status: 404,
			error: "No browser windows are open in the desktop app.",
			windows,
		};
	}

	const exact = windows.find((w) => w.paneId === query);
	if (exact) return { ok: true, window: exact };

	const needle = query.trim().toLowerCase();
	const matches = windows.filter(
		(w) =>
			w.title.toLowerCase().includes(needle) ||
			w.url.toLowerCase().includes(needle),
	);

	if (matches.length === 1) return { ok: true, window: matches[0] };
	if (matches.length === 0) {
		return {
			ok: false,
			status: 404,
			error: `No browser window matches "${query}".`,
			windows,
		};
	}
	return {
		ok: false,
		status: 409,
		error: `Multiple browser windows match "${query}" — use a more specific title/URL fragment or a paneId.`,
		windows: matches,
	};
}

function windowQueryFromBody(req: Request, res: Response): string | null {
	const query = (req.body as { window?: unknown } | undefined)?.window;
	if (typeof query !== "string" || query.trim() === "") {
		res.status(400).json({
			error:
				"Missing required string field `window` (paneId, or a title/URL fragment).",
		});
		return null;
	}
	return query;
}

function safeFileStem(paneId: string): string {
	return paneId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export const BROWSER_SCREENSHOTS_DIR = path.join(
	SUPERSET_HOME_DIR,
	"browser-screenshots",
);

/**
 * Localhost control surface over the desktop app's embedded browser panes,
 * mounted on the notifications server so the host-service (which already
 * knows this port via SUPERSET_AGENT_HOOK_PORT) can list, screenshot, and
 * reload browser windows on behalf of MCP tools.
 */
export function registerBrowserControlRoutes(app: Express): void {
	app.get("/browser/windows", (_req, res) => {
		res.json({ windows: browserManager.listWindows() });
	});

	app.post("/browser/screenshot", async (req, res) => {
		const query = windowQueryFromBody(req, res);
		if (query === null) return;

		const resolution = resolveWindow(query);
		if (!resolution.ok) {
			return res
				.status(resolution.status)
				.json({ error: resolution.error, windows: resolution.windows });
		}

		const { paneId, title, url } = resolution.window;
		const requestedPath = (req.body as { outputPath?: unknown }).outputPath;
		if (requestedPath !== undefined && typeof requestedPath !== "string") {
			return res.status(400).json({ error: "`outputPath` must be a string." });
		}
		const outputPath =
			requestedPath && path.isAbsolute(requestedPath)
				? requestedPath
				: path.join(BROWSER_SCREENSHOTS_DIR, `${safeFileStem(paneId)}.png`);
		if (requestedPath && !path.isAbsolute(requestedPath)) {
			return res
				.status(400)
				.json({ error: "`outputPath` must be an absolute path." });
		}

		const wc = browserManager.getWebContents(paneId);
		if (!wc) {
			return res
				.status(404)
				.json({ error: `Browser window "${paneId}" is no longer available.` });
		}

		try {
			const image = await wc.capturePage();
			await fs.mkdir(path.dirname(outputPath), { recursive: true });
			await fs.writeFile(outputPath, image.toPNG());
			res.json({ paneId, title, url, path: outputPath });
		} catch (error) {
			res.status(500).json({
				error: `Screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	});

	app.post("/browser/reload", (req, res) => {
		const query = windowQueryFromBody(req, res);
		if (query === null) return;

		const resolution = resolveWindow(query);
		if (!resolution.ok) {
			return res
				.status(resolution.status)
				.json({ error: resolution.error, windows: resolution.windows });
		}

		const { paneId, title, url } = resolution.window;
		const wc = browserManager.getWebContents(paneId);
		if (!wc) {
			return res
				.status(404)
				.json({ error: `Browser window "${paneId}" is no longer available.` });
		}

		if ((req.body as { hard?: unknown }).hard === true) {
			wc.reloadIgnoringCache();
		} else {
			wc.reload();
		}
		res.json({ paneId, title, url, reloaded: true });
	});
}
