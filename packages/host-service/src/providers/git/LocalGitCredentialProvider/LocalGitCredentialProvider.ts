import { execFile } from "node:child_process";
import type { GitCredentialProvider } from "../../../runtime/git/types";

const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
// Cache null (no-token) results too. Without this, a background poller that
// runs every 10s (PullRequestRuntimeManager) will re-invoke `git credential
// fill` on every tick, which on macOS triggers the `git-credential-osxkeychain`
// helper and pops a Keychain access modal at the same cadence. We accept a
// short delay before recovering once the user actually configures credentials.
const NULL_TOKEN_CACHE_TTL_MS = 60 * 1000;

type TokenFetcher = (
	host: string,
	env: Record<string, string>,
) => Promise<string | null>;

export class LocalGitCredentialProvider implements GitCredentialProvider {
	private envResolver: () => Promise<Record<string, string>>;
	private tokenFetcher: TokenFetcher;
	private cachedToken: { token: string | null; expiresAt: number } | null =
		null;
	private inflight: Promise<string | null> | null = null;

	constructor(
		envResolver: () => Promise<Record<string, string>> = async () =>
			process.env as Record<string, string>,
		tokenFetcher: TokenFetcher = fetchTokenViaGitCredential,
	) {
		this.envResolver = envResolver;
		this.tokenFetcher = tokenFetcher;
	}

	async getCredentials(
		_remoteUrl: string | null,
	): Promise<{ env: Record<string, string> }> {
		return { env: await this.envResolver() };
	}

	async getToken(host: string): Promise<string | null> {
		const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
		if (envToken) return envToken;

		if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
			return this.cachedToken.token;
		}

		if (this.inflight) return this.inflight;

		const promise = this.resolveToken(host).finally(() => {
			this.inflight = null;
		});
		this.inflight = promise;
		return promise;
	}

	private async resolveToken(host: string): Promise<string | null> {
		const env = await this.envResolver();
		const token = await this.tokenFetcher(host, env);
		this.cachedToken = {
			token,
			expiresAt:
				Date.now() + (token ? TOKEN_CACHE_TTL_MS : NULL_TOKEN_CACHE_TTL_MS),
		};
		return token;
	}
}

function fetchTokenViaGitCredential(
	host: string,
	env: Record<string, string>,
): Promise<string | null> {
	return new Promise((resolve) => {
		const child = execFile(
			"git",
			["credential", "fill"],
			{ timeout: 10_000, env },
			(error, stdout) => {
				if (error) {
					resolve(null);
					return;
				}
				const match = stdout.match(/^password=(.+)$/m);
				resolve(match?.[1]?.trim() ?? null);
			},
		);
		child.stdin?.write(`protocol=https\nhost=${host}\n\n`);
		child.stdin?.end();
	});
}
