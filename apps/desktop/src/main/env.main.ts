/**
 * Environment variables for the MAIN PROCESS (Node.js context).
 *
 * This file uses t3-env with process.env which works at runtime in Node.js.
 * Only import this file in src/main/ code - never in renderer or shared code.
 *
 * For renderer process env vars, use src/renderer/env.renderer.ts instead.
 */
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

// NOTE: the deployment-profile check is inlined here rather than imported
// from @superset/shared/deployment-profile because electron.vite.config.ts
// does `await import("./src/main/env.main")` at config-load time, which
// Node's ESM loader handles directly (no Vite transform) — and Node can't
// load `.ts` files from sibling workspace packages. Keep the helper in
// shared/, but duplicate the four lines here.
//
// Default profile is `internal` (strict). OSS contributors set
// SUPERSET_OSS=1 to opt into the lenient `oss-dev` profile, which
// skips env validation so a fresh clone boots without every key.
// CI=true (auto-set by GitHub Actions) also opts into lenient so
// build/lint/test jobs work without prod secrets.
// SKIP_ENV_VALIDATION=1 remains a build-time escape hatch.
const isStrict =
	process.env.VERCEL === "1" ||
	(process.env.SUPERSET_OSS !== "1" && process.env.CI !== "true");
const skipValidation = !isStrict || !!process.env.SKIP_ENV_VALIDATION;

export const env = createEnv({
	server: {
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		// In dev builds (NODE_ENV=development) the URL defaults switch to
		// localhost so fresh-clone OSS contributors never silently sync
		// against hosted production endpoints.
		NEXT_PUBLIC_API_URL: z
			.url()
			.default(
				process.env.NODE_ENV === "development"
					? "http://localhost:4641"
					: "https://api.superset.sh",
			),
		NEXT_PUBLIC_STREAMS_URL: z
			.url()
			.default(
				process.env.NODE_ENV === "development"
					? "http://localhost:4647"
					: "https://streams.superset.sh",
			),
		NEXT_PUBLIC_ELECTRIC_URL: z
			.url()
			.default(
				process.env.NODE_ENV === "development"
					? "https://localhost:4650"
					: "https://electric-proxy.avi-6ac.workers.dev",
			),
		NEXT_PUBLIC_WEB_URL: z
			.url()
			.default(
				process.env.NODE_ENV === "development"
					? "http://localhost:4640"
					: "https://app.superset.sh",
			),
		NEXT_PUBLIC_MARKETING_URL: z.url().default("https://superset.sh"),
		NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
		NEXT_PUBLIC_POSTHOG_HOST: z.string().default("https://us.i.posthog.com"),
		SENTRY_DSN_DESKTOP: z.string().optional(),
		STREAMS_URL: z
			.url()
			.default(
				process.env.NODE_ENV === "development"
					? "http://localhost:4647"
					: "https://superset-stream.fly.dev",
			),
		RELAY_URL: z
			.url()
			.default(
				process.env.NODE_ENV === "development"
					? "http://localhost:4653"
					: "https://relay.superset.sh",
			),
	},

	runtimeEnv: {
		...process.env,
		// Explicitly list env vars so Vite can replace them at build time
		// (spreading process.env only works at runtime, not for bundled apps)
		NODE_ENV: process.env.NODE_ENV,
		NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
		NEXT_PUBLIC_STREAMS_URL: process.env.NEXT_PUBLIC_STREAMS_URL,
		NEXT_PUBLIC_ELECTRIC_URL: process.env.NEXT_PUBLIC_ELECTRIC_URL,
		NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
		NEXT_PUBLIC_MARKETING_URL: process.env.NEXT_PUBLIC_MARKETING_URL,
		NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
		NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
		SENTRY_DSN_DESKTOP: process.env.SENTRY_DSN_DESKTOP,
		STREAMS_URL: process.env.STREAMS_URL,
		RELAY_URL: process.env.RELAY_URL,
	},
	emptyStringAsUndefined: true,
	skipValidation,

	// Main process runs in trusted Node.js environment
	isServer: true,
});
