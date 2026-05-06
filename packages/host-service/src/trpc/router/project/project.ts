import { basename, resolve as resolvePath } from "node:path";
import {
	type ParsedGitHubRemote,
	parseGitHubRemote,
} from "@superset/shared/github-remote";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import simpleGit from "simple-git";
import { z } from "zod";
import { projects, workspaces } from "../../../db/schema";
import { protectedProcedure, router } from "../../index";
import {
	createFromClone,
	createFromEmpty,
	createFromImportLocal,
	createFromTemplate,
} from "./handlers";
import { ensureMainWorkspace } from "./utils/ensure-main-workspace";
import { getGitHubRemotes } from "./utils/git-remote";
import { persistLocalProject } from "./utils/persist-project";
import {
	cloneRepoInto,
	type ResolvedRepo,
	resolveLocalRepo,
	resolveMatchingSlug,
} from "./utils/resolve-repo";

export const projectRouter = router({
	list: protectedProcedure.query(({ ctx }) => {
		return ctx.db
			.select({
				id: projects.id,
				repoPath: projects.repoPath,
				repoOwner: projects.repoOwner,
				repoName: projects.repoName,
				repoUrl: projects.repoUrl,
			})
			.from(projects)
			.all();
	}),

	/**
	 * Asks cloud (not the local DB cache) for the live set of v2 projects in
	 * this org. Used by the v1→v2 importer to detect stale audit-log rows
	 * that point at projects another device or user has since deleted.
	 */
	cloudList: protectedProcedure.query(async ({ ctx }) => {
		const rows = await ctx.api.v2Project.list.query({
			organizationId: ctx.organizationId,
		});
		return rows.map((row) => ({ id: row.id, name: row.name }));
	}),

	get: protectedProcedure
		.input(z.object({ projectId: z.string().uuid() }))
		.query(({ ctx, input }) => {
			return (
				ctx.db
					.select({
						id: projects.id,
						repoPath: projects.repoPath,
						repoOwner: projects.repoOwner,
						repoName: projects.repoName,
						repoUrl: projects.repoUrl,
					})
					.from(projects)
					.where(eq(projects.id, input.projectId))
					.get() ?? null
			);
		}),

	findBackfillConflict: protectedProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				repoPath: z.string().min(1),
			}),
		)
		.query(() => {
			// Multiple v2 projects may point at the same GitHub URL, so a matching
			// repo URL is no longer a conflict. Kept for backwards-compatible
			// clients while older settings screens still call the endpoint.
			return { conflict: null };
		}),

	findByPath: protectedProcedure
		.input(
			z.object({
				repoPath: z.string().min(1),
				/**
				 * Optional hint from the caller (e.g. v1→v2 importer) about the
				 * remote URL the caller *thinks* this project tracks. We cloud-
				 * query this URL even if it's not currently among the local
				 * repo's remotes, and tag the matching candidate as
				 * `matchesExpected: true` so the UI can recommend it. Lets us
				 * surface the right v2 project when local git remotes have
				 * drifted (e.g. user cloned a fork as origin).
				 */
				expectedRemoteUrl: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			// `resolveLocalRepo` validates the path is a git working tree and
			// returns the canonical git root. We then re-read all remotes
			// (rather than just origin/first) so callers see every cloud
			// project that could plausibly match.
			const resolved = await resolveLocalRepo(input.repoPath);
			const gitRoot = resolved.repoPath;
			const allRemotes = await getGitHubRemotes(simpleGit(gitRoot));

			const expectedParsed = input.expectedRemoteUrl
				? parseGitHubRemote(input.expectedRemoteUrl)
				: null;

			// Build the set of GitHub URLs to ask cloud about: every parseable
			// remote on this repo, plus the caller's expected URL if any.
			const urlsToQuery = new Map<string, ParsedGitHubRemote>();
			for (const parsed of allRemotes.values()) {
				urlsToQuery.set(parsed.url.toLowerCase(), parsed);
			}
			if (expectedParsed) {
				urlsToQuery.set(expectedParsed.url.toLowerCase(), expectedParsed);
			}

			interface Candidate {
				id: string;
				name: string;
				repoCloneUrl: string | null;
				source: "local-path" | "remote";
				matchesExpected: boolean;
				/** True when this v2 project is no longer reachable in cloud
				 *  (e.g. deleted) but a stale row still lives in this device's
				 *  local DB. The UI should drop or visibly mark these. */
				staleLocalLink: boolean;
			}
			const byId = new Map<string, Candidate>();

			const expectedUrlLower = expectedParsed?.url.toLowerCase();
			const matches = (cloneUrl: string | null) =>
				!!expectedUrlLower &&
				!!cloneUrl &&
				cloneUrl.toLowerCase() === expectedUrlLower;

			// Local-DB lookup by path. Don't short-circuit — we still want to
			// surface other v2 projects in the org so the picker can offer
			// alternatives when the local row is stale.
			const localProject = ctx.db.query.projects
				.findFirst({ where: eq(projects.repoPath, gitRoot) })
				.sync();
			if (localProject) {
				byId.set(localProject.id, {
					id: localProject.id,
					name: localProject.repoName ?? basename(gitRoot),
					repoCloneUrl: localProject.repoUrl ?? null,
					source: "local-path",
					matchesExpected: matches(localProject.repoUrl ?? null),
					// Filled in below after we hear back from cloud.
					staleLocalLink: false,
				});
			}

			// Cloud lookup for every URL we know about.
			const cloudErrors: { url: string; message: string }[] = [];
			for (const parsed of urlsToQuery.values()) {
				try {
					const { candidates } =
						await ctx.api.v2Project.findByGitHubRemote.query({
							organizationId: ctx.organizationId,
							repoCloneUrl: parsed.url,
						});
					for (const c of candidates) {
						const existing = byId.get(c.id);
						if (existing) {
							// Already have it from local-DB lookup; the cloud
							// confirms it's reachable, so keep `local-path`
							// source but populate matchesExpected if needed.
							existing.matchesExpected =
								existing.matchesExpected || matches(parsed.url);
							existing.repoCloneUrl = existing.repoCloneUrl ?? parsed.url;
						} else {
							byId.set(c.id, {
								id: c.id,
								name: c.name,
								repoCloneUrl: parsed.url,
								source: "remote",
								matchesExpected: matches(parsed.url),
								staleLocalLink: false,
							});
						}
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					cloudErrors.push({ url: parsed.url, message });
					console.warn(
						"[project.findByPath] cloud findByGitHubRemote failed for",
						parsed.url,
						err,
					);
				}
			}

			// Detect stale local-DB row: returned by the path lookup but cloud
			// never confirmed it via any remote URL. Two ways this happens:
			// (a) the cloud project was deleted; (b) the local row's tracked
			// remote URL no longer matches any current remote on the repo.
			if (localProject) {
				const candidate = byId.get(localProject.id);
				if (candidate && candidate.source === "local-path") {
					try {
						await ctx.api.v2Project.get.query({
							organizationId: ctx.organizationId,
							id: localProject.id,
						});
					} catch {
						candidate.staleLocalLink = true;
					}
				}
			}

			// Sort: matchesExpected first, then alphabetic.
			const candidates = Array.from(byId.values())
				.filter((c) => !c.staleLocalLink)
				.sort((a, b) => {
					if (a.matchesExpected !== b.matchesExpected) {
						return a.matchesExpected ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});

			// Caller surfaces this when there are no candidates and at least
			// one cloud query failed — so users see a clear "couldn't reach
			// cloud" instead of a misleading "Import" (which would create a
			// duplicate v2 project).
			return { candidates, cloudErrors };
		}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				mode: z.discriminatedUnion("kind", [
					z.object({
						kind: z.literal("empty"),
						parentDir: z.string().min(1),
					}),
					z.object({
						kind: z.literal("clone"),
						parentDir: z.string().min(1),
						url: z.string().min(1),
					}),
					z.object({
						kind: z.literal("importLocal"),
						repoPath: z.string().min(1),
					}),
					z.object({
						kind: z.literal("template"),
						parentDir: z.string().min(1),
						templateId: z.string().min(1),
					}),
				]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			switch (input.mode.kind) {
				case "empty":
					return createFromEmpty(ctx, {
						name: input.name,
						parentDir: input.mode.parentDir,
					});
				case "template":
					return createFromTemplate(ctx, {
						name: input.name,
						parentDir: input.mode.parentDir,
						templateId: input.mode.templateId,
					});
				case "clone":
					return createFromClone(ctx, {
						name: input.name,
						parentDir: input.mode.parentDir,
						url: input.mode.url,
					});
				case "importLocal":
					return createFromImportLocal(ctx, {
						name: input.name,
						repoPath: input.mode.repoPath,
					});
			}
		}),

	setup: protectedProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				mode: z.discriminatedUnion("kind", [
					z.object({
						kind: z.literal("clone"),
						parentDir: z.string().min(1),
					}),
					z.object({
						kind: z.literal("import"),
						repoPath: z.string().min(1),
						allowRelocate: z.boolean().default(false),
					}),
				]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const existing = ctx.db
				.select({ id: projects.id, repoPath: projects.repoPath })
				.from(projects)
				.where(eq(projects.id, input.projectId))
				.get();

			const cloudProject = await ctx.api.v2Project.get.query({
				organizationId: ctx.organizationId,
				id: input.projectId,
			});

			const allowRelocate =
				input.mode.kind === "import" && input.mode.allowRelocate;

			const rejectIfRepoint = (targetPath: string) => {
				if (!existing) return;
				if (existing.repoPath === targetPath) return;
				if (allowRelocate) return;
				throw new TRPCError({
					code: "CONFLICT",
					message: `Project is already set up on this device at ${existing.repoPath}. Remove it first to re-import at a different location.`,
				});
			};

			switch (input.mode.kind) {
				case "clone": {
					if (!cloudProject.repoCloneUrl) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message:
								"Project has no linked GitHub repository — cannot clone. Import an existing local folder instead.",
						});
					}
					const expectedParsed = parseGitHubRemote(cloudProject.repoCloneUrl);
					if (!expectedParsed) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Could not parse GitHub remote from ${cloudProject.repoCloneUrl}`,
						});
					}
					const predictedPath = resolvePath(
						input.mode.parentDir,
						expectedParsed.name,
					);
					rejectIfRepoint(predictedPath);
					if (existing) {
						const mainWorkspace = await ensureMainWorkspace(
							ctx,
							input.projectId,
							existing.repoPath,
						);
						return {
							repoPath: existing.repoPath,
							mainWorkspaceId: mainWorkspace?.id ?? null,
						};
					}
					const resolved = await cloneRepoInto(
						cloudProject.repoCloneUrl,
						input.mode.parentDir,
					);
					persistLocalProject(ctx, input.projectId, resolved);
					const mainWorkspace = await ensureMainWorkspace(
						ctx,
						input.projectId,
						resolved.repoPath,
					);
					return {
						repoPath: resolved.repoPath,
						mainWorkspaceId: mainWorkspace?.id ?? null,
					};
				}
				case "import": {
					let resolved: ResolvedRepo;
					if (cloudProject.repoCloneUrl) {
						const parsed = parseGitHubRemote(cloudProject.repoCloneUrl);
						if (!parsed) {
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: `Could not parse GitHub remote from ${cloudProject.repoCloneUrl}`,
							});
						}
						resolved = await resolveMatchingSlug(
							input.mode.repoPath,
							`${parsed.owner}/${parsed.name}`,
						);
					} else {
						resolved = await resolveLocalRepo(input.mode.repoPath);
					}

					// Each on-disk repo path maps to at most one project in the
					// local DB; importing the same folder under a second project
					// would clobber the first. Cloud-side GitHub URL collisions
					// are allowed (see findBackfillConflict), but local-path
					// collisions are not.
					const localOwner = ctx.db
						.select({ id: projects.id })
						.from(projects)
						.where(eq(projects.repoPath, resolved.repoPath))
						.get();
					if (localOwner && localOwner.id !== input.projectId) {
						throw new TRPCError({
							code: "CONFLICT",
							message:
								"Repository is already set up as another project on this device.",
						});
					}

					rejectIfRepoint(resolved.repoPath);
					if (existing && existing.repoPath === resolved.repoPath) {
						const mainWorkspace = await ensureMainWorkspace(
							ctx,
							input.projectId,
							existing.repoPath,
						);
						return {
							repoPath: existing.repoPath,
							mainWorkspaceId: mainWorkspace?.id ?? null,
						};
					}

					if (!cloudProject.repoCloneUrl && resolved.parsed) {
						await ctx.api.v2Project.linkRepoCloneUrl.mutate({
							organizationId: ctx.organizationId,
							id: input.projectId,
							repoCloneUrl: resolved.parsed.url,
						});
					}
					persistLocalProject(ctx, input.projectId, resolved);
					const mainWorkspace = await ensureMainWorkspace(
						ctx,
						input.projectId,
						resolved.repoPath,
					);
					return {
						repoPath: resolved.repoPath,
						mainWorkspaceId: mainWorkspace?.id ?? null,
					};
				}
			}
		}),

	/**
	 * Project-delete saga. Cloud is reality — cloud delete is the kill point:
	 *
	 *   1. Cloud v2Project.delete   ← kill point. Cascades cloud workspaces.
	 *      on fail → abort, leave local untouched, surface error to user.
	 *
	 *   2. Local DB rows (workspaces + project)
	 *      on fail → log; user can re-run later. Cloud is already gone.
	 *
	 *   3. Best-effort `git worktree remove` for each non-main local
	 *      workspace so subsequent worktree commands aren't confused.
	 *
	 * The on-disk repo directory is NEVER auto-removed. The user's code is
	 * their code; deletion of the working tree must be an explicit action,
	 * not a side-effect of project removal. Returns repoPath so a future
	 * UI can offer an explicit "delete files too" follow-up.
	 */
	remove: protectedProcedure
		.input(z.object({ projectId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.api.v2Project.delete.mutate({
				organizationId: ctx.organizationId,
				id: input.projectId,
			});

			const localProject = ctx.db.query.projects
				.findFirst({ where: eq(projects.id, input.projectId) })
				.sync();

			if (!localProject) return { success: true, repoPath: null };

			const localWorkspaces = ctx.db
				.select()
				.from(workspaces)
				.where(eq(workspaces.projectId, input.projectId))
				.all();

			for (const ws of localWorkspaces) {
				if (ws.worktreePath === localProject.repoPath) continue;
				try {
					const git = await ctx.git(localProject.repoPath);
					await git.raw(["worktree", "remove", ws.worktreePath]);
				} catch (err) {
					console.warn("[project.remove] failed to remove worktree", {
						projectId: input.projectId,
						worktreePath: ws.worktreePath,
						err,
					});
				}
			}

			try {
				ctx.db
					.delete(workspaces)
					.where(eq(workspaces.projectId, input.projectId))
					.run();
				ctx.db.delete(projects).where(eq(projects.id, input.projectId)).run();
			} catch (err) {
				console.warn("[project.remove] failed to delete local rows", {
					projectId: input.projectId,
					err,
				});
			}

			return { success: true, repoPath: localProject.repoPath };
		}),
});
