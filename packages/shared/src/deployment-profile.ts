/**
 * Deployment profile resolution.
 *
 * Four profiles, ranked by discriminator trust:
 *
 *   1. `cloud`         — Vercel sets `VERCEL=1` automatically. Contributors
 *                        can't fake it locally.
 *   2. `internal-dev`  — `.superset/setup.sh` writes `SUPERSET_INTERNAL_DEV=1`
 *                        into per-workspace `.env`. Never appears in
 *                        `.env.example`, never mentioned in `docs/`.
 *                        Positive-presence flag — contributors won't type it.
 *   3. `self-hosted`   — `NODE_ENV=production` outside Vercel (Docker, bare
 *                        metal). Strict-by-default; operator opted in.
 *   4. `oss-dev`       — default for a fresh clone. Lenient: integration keys
 *                        are optional and features degrade gracefully.
 *
 * **Strict profiles** (`cloud`, `internal-dev`, `self-hosted`) hard-fail at
 * boot when an integration key is missing — matches the existing prod and
 * internal-dev behavior.
 *
 * **Lenient profile** (`oss-dev`) allows the app to boot with missing keys;
 * call sites lazy-throw / no-op so features degrade visibly rather than
 * crashing module load.
 *
 * Why this axis instead of `NODE_ENV`? `NODE_ENV=development` covers both
 * OSS contributors and internal team members — same code path, very
 * different expectations. The sentinel discriminator (`SUPERSET_INTERNAL_DEV`)
 * cleanly separates them.
 */
export type DeploymentProfile =
	| "cloud"
	| "internal-dev"
	| "self-hosted"
	| "oss-dev";

export function getDeploymentProfile(
	envSource: Record<string, string | undefined> = process.env,
): DeploymentProfile {
	if (envSource.VERCEL === "1") return "cloud";
	if (envSource.SUPERSET_INTERNAL_DEV === "1") return "internal-dev";
	if (envSource.NODE_ENV === "production") return "self-hosted";
	return "oss-dev";
}

export function isStrictProfile(profile: DeploymentProfile): boolean {
	return (
		profile === "cloud" ||
		profile === "internal-dev" ||
		profile === "self-hosted"
	);
}
