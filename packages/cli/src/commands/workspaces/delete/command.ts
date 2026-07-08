import { boolean, CLIError, positional, string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { resolveHostFilter, resolveHostTarget } from "../../../lib/host-target";

export default command({
	description: "Delete workspaces by ID",
	args: [positional("ids").required().variadic().desc("Workspace IDs")],
	options: {
		host: string().desc("Skip the cloud lookup and target this host directly"),
		local: boolean().desc("Skip the cloud lookup and target this machine"),
	},
	run: async ({ ctx, args, options }) => {
		const ids = args.ids as string[];
		const organizationId = ctx.config.organizationId;
		if (!organizationId) {
			throw new CLIError("No active organization", "Run: superset auth login");
		}

		const explicitHostId = resolveHostFilter({
			host: options.host ?? undefined,
			local: options.local ?? undefined,
		});

		const deleted: string[] = [];
		const notFound: string[] = [];
		const failed: { id: string; error: string }[] = [];
		const warnings: string[] = [];
		// Process every ID independently: a stale/not-found ID or a single failed
		// delete must not abort the rest of the batch (#5497).
		for (const id of ids) {
			try {
				let hostId = explicitHostId;
				if (!hostId) {
					const cloudWorkspace = await ctx.api.v2Workspace.getFromHost.query({
						organizationId,
						id,
					});
					if (!cloudWorkspace) {
						// Delete is idempotent: an already-gone workspace is a no-op,
						// not a failure.
						notFound.push(id);
						continue;
					}
					hostId = cloudWorkspace.hostId;
				}

				const target = resolveHostTarget({
					requestedHostId: hostId,
					organizationId,
					userJwt: ctx.bearer,
				});

				const result = await target.client.workspace.delete.mutate({ id });
				deleted.push(id);
				for (const warning of result.warnings ?? []) {
					warnings.push(`${id}: ${warning}`);
				}
			} catch (error) {
				failed.push({
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const lines: string[] = [];
		if (deleted.length > 0) {
			lines.push(
				deleted.length === 1
					? `Deleted workspace ${deleted[0]}`
					: `Deleted ${deleted.length} workspaces`,
			);
		}
		if (notFound.length > 0) {
			lines.push(
				`Not found (already deleted):\n${notFound.map((id) => `- ${id}`).join("\n")}`,
			);
		}
		if (failed.length > 0) {
			lines.push(
				`Failed to delete:\n${failed.map(({ id, error }) => `- ${id}: ${error}`).join("\n")}`,
			);
		}
		if (warnings.length > 0) {
			lines.push(
				`Warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`,
			);
		}
		const message = lines.join("\n") || "No workspaces to delete";

		// Exit non-zero if any delete genuinely failed, while still surfacing the
		// full per-ID summary.
		if (failed.length > 0) {
			throw new CLIError(message);
		}

		return {
			data: { deleted, notFound, failed, warnings },
			message,
		};
	},
});
