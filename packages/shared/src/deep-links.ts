/**
 * Shared deep-link URL builders for desktop (`superset://`) and web
 * (`https://app.superset.sh/`) entry points. Used by CLI, SDK, and MCP so
 * every surface returns identical URLs.
 *
 * Desktop deep links are handled by `processDeepLink` in
 * `apps/desktop/src/main/index.ts` which strips the scheme and navigates to
 * the path in the renderer.
 */

import { PROTOCOL_SCHEMES } from "./constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeepLink {
	desktop: string;
	web: string;
}

export interface DeepLinkOptions {
	/** Base web URL, e.g. `"https://app.superset.sh"`. */
	webBaseUrl?: string;
	/**
	 * Protocol scheme for the desktop link. Defaults to `"superset"`.
	 * Use `"superset-dev"` for local development builds.
	 */
	desktopScheme?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WEB_BASE = "https://app.superset.sh";
const DEFAULT_SCHEME = PROTOCOL_SCHEMES.PROD;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPair(path: string, opts: DeepLinkOptions | undefined): DeepLink {
	const scheme = opts?.desktopScheme ?? DEFAULT_SCHEME;
	const webBase = (opts?.webBaseUrl ?? DEFAULT_WEB_BASE).replace(/\/+$/, "");
	return {
		desktop: `${scheme}://${path}`,
		web: `${webBase}/${path}`,
	};
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/** Link to the workspace overview. */
export function workspaceLink(
	workspaceId: string,
	opts?: DeepLinkOptions,
): DeepLink {
	return buildPair(`v2-workspace/${workspaceId}`, opts);
}

/** Link to a specific terminal inside a workspace. */
export function terminalLink(
	workspaceId: string,
	terminalId: string,
	opts?: DeepLinkOptions,
): DeepLink {
	return buildPair(
		`v2-workspace/${workspaceId}?terminalId=${encodeURIComponent(terminalId)}`,
		opts,
	);
}

/** Link to a chat session inside a workspace. */
export function chatSessionLink(
	workspaceId: string,
	sessionId: string,
	opts?: DeepLinkOptions,
): DeepLink {
	return buildPair(
		`v2-workspace/${workspaceId}?chatSessionId=${encodeURIComponent(sessionId)}`,
		opts,
	);
}
