import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { LocalGitCredentialProvider } from "./LocalGitCredentialProvider";

describe("LocalGitCredentialProvider.getToken", () => {
	const originalGithubToken = process.env.GITHUB_TOKEN;
	const originalGhToken = process.env.GH_TOKEN;

	beforeEach(() => {
		process.env.GITHUB_TOKEN = undefined;
		process.env.GH_TOKEN = undefined;
		delete process.env.GITHUB_TOKEN;
		delete process.env.GH_TOKEN;
	});

	afterEach(() => {
		if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
		else process.env.GITHUB_TOKEN = originalGithubToken;
		if (originalGhToken === undefined) delete process.env.GH_TOKEN;
		else process.env.GH_TOKEN = originalGhToken;
	});

	test("caches successful tokens across calls", async () => {
		const tokenFetcher = mock(async () => "ghp_secret");
		const provider = new LocalGitCredentialProvider(
			async () => ({}),
			tokenFetcher,
		);

		expect(await provider.getToken("github.com")).toBe("ghp_secret");
		expect(await provider.getToken("github.com")).toBe("ghp_secret");
		expect(await provider.getToken("github.com")).toBe("ghp_secret");

		expect(tokenFetcher).toHaveBeenCalledTimes(1);
	});

	// Reproduces #3829: V2 early-access enables a background poller that
	// invokes ctx.github() (-> getToken("github.com")) every 10 seconds.
	// Without caching null results, every tick re-runs `git credential fill`,
	// which on macOS goes through `git-credential-osxkeychain` and shows a
	// Keychain access modal each time. The fetcher MUST NOT be invoked once
	// per call when the underlying credential helper has nothing to return.
	test("caches null (no-token) results so the credential helper isn't re-invoked on every poll", async () => {
		const tokenFetcher = mock(async () => null);
		const provider = new LocalGitCredentialProvider(
			async () => ({}),
			tokenFetcher,
		);

		expect(await provider.getToken("github.com")).toBeNull();
		expect(await provider.getToken("github.com")).toBeNull();
		expect(await provider.getToken("github.com")).toBeNull();

		expect(tokenFetcher).toHaveBeenCalledTimes(1);
	});

	test("coalesces concurrent calls into a single fetch", async () => {
		const fetchStarted = Promise.withResolvers<void>();
		const fetchFinish = Promise.withResolvers<string | null>();
		const tokenFetcher = mock(() => {
			fetchStarted.resolve();
			return fetchFinish.promise;
		});
		const provider = new LocalGitCredentialProvider(
			async () => ({}),
			tokenFetcher,
		);

		const a = provider.getToken("github.com");
		await fetchStarted.promise;
		const b = provider.getToken("github.com");
		const c = provider.getToken("github.com");

		fetchFinish.resolve("ghp_secret");

		expect(await a).toBe("ghp_secret");
		expect(await b).toBe("ghp_secret");
		expect(await c).toBe("ghp_secret");
		expect(tokenFetcher).toHaveBeenCalledTimes(1);
	});

	test("prefers GITHUB_TOKEN env var over the credential helper", async () => {
		process.env.GITHUB_TOKEN = "env_token";
		const tokenFetcher = mock(async () => "ghp_secret");
		const provider = new LocalGitCredentialProvider(
			async () => ({}),
			tokenFetcher,
		);

		expect(await provider.getToken("github.com")).toBe("env_token");
		expect(tokenFetcher).not.toHaveBeenCalled();
	});
});
