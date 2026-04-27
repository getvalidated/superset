import { rmSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../../../types";
import { persistLocalProject } from "./utils/persist-project";
import { cloneRepoInto, resolveLocalRepo } from "./utils/resolve-repo";

function slugifyProjectName(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!slug) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Project name must contain at least one alphanumeric character",
		});
	}
	return slug;
}

interface CreateResult {
	projectId: string;
	repoPath: string;
}

function slugWithSuffix(baseSlug: string, attempt: number): string {
	return attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
}

function isSlugConflict(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	const lower = message.toLowerCase();
	return lower.includes("v2_projects_org_slug_unique");
}

async function createCloudProjectWithSlugRetry(
	ctx: HostServiceContext,
	args: { name: string; repoCloneUrl?: string },
) {
	const baseSlug = slugifyProjectName(args.name);
	let lastError: unknown;
	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			return await ctx.api.v2Project.create.mutate({
				organizationId: ctx.organizationId,
				name: args.name,
				slug: slugWithSuffix(baseSlug, attempt),
				repoCloneUrl: args.repoCloneUrl,
			});
		} catch (err) {
			if (!isSlugConflict(err)) throw err;
			lastError = err;
		}
	}
	throw lastError;
}

/**
 * Clone first so clone-time failures (bad URL, auth, network, dir
 * collision) leave no cloud state behind. The local clone can be removed
 * if later steps fail, but cloud projects are durable once created.
 */
export async function createFromClone(
	ctx: HostServiceContext,
	args: { name: string; parentDir: string; url: string },
): Promise<CreateResult> {
	const resolved = await cloneRepoInto(args.url, args.parentDir);
	try {
		const cloudProject = await createCloudProjectWithSlugRetry(ctx, {
			name: args.name,
			repoCloneUrl: args.url,
		});
		persistLocalProject(ctx, cloudProject.id, resolved);
		return { projectId: cloudProject.id, repoPath: resolved.repoPath };
	} catch (err) {
		try {
			rmSync(resolved.repoPath, { recursive: true, force: true });
		} catch (cleanupErr) {
			console.warn(
				"[project.createFromClone] failed to rollback clone after cloud error",
				{ repoPath: resolved.repoPath, cleanupErr },
			);
		}
		throw err;
	}
}

export async function createFromImportLocal(
	ctx: HostServiceContext,
	args: { name: string; repoPath: string },
): Promise<CreateResult> {
	const resolved = await resolveLocalRepo(args.repoPath);
	const cloudProject = await createCloudProjectWithSlugRetry(ctx, {
		name: args.name,
		repoCloneUrl: resolved.parsed?.url,
	});
	persistLocalProject(ctx, cloudProject.id, resolved);
	return { projectId: cloudProject.id, repoPath: resolved.repoPath };
}
