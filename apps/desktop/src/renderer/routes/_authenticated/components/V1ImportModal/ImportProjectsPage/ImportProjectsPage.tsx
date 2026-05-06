import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { LuFolder } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useFinalizeProjectSetup } from "renderer/react-query/projects";
import { ImportPageShell } from "../components/ImportPageShell";
import { ImportRow, type RowAction } from "../components/ImportRow";

interface ImportProjectsPageProps {
	organizationId: string;
	activeHostUrl: string;
}

interface AuditLogEntry {
	v2Id: string | null;
	status: string;
	reason: string | null;
}

const FIND_BY_PATH_KEY_PREFIX = ["v1-import", "findByPath"] as const;
const PROJECT_CLOUD_LIST_KEY = ["v1-import", "projectCloudList"] as const;

export function ImportProjectsPage({
	organizationId,
	activeHostUrl,
}: ImportProjectsPageProps) {
	const queryClient = useQueryClient();
	const projectsQuery = electronTrpc.migration.readV1Projects.useQuery();
	const auditQuery = electronTrpc.migration.listState.useQuery({
		organizationId,
	});
	const cloudProjectsQuery = useQuery({
		queryKey: [...PROJECT_CLOUD_LIST_KEY, organizationId, activeHostUrl],
		queryFn: async () => {
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.project.cloudList.query();
		},
		retry: false,
	});
	const [isRefreshing, setIsRefreshing] = useState(false);

	const liveProjectIds = useMemo(() => {
		// Returns null until the cloud query resolves so per-row code can
		// distinguish "we don't know yet" from "it's gone".
		if (!cloudProjectsQuery.data) return null;
		return new Set(cloudProjectsQuery.data.map((p) => p.id));
	}, [cloudProjectsQuery.data]);

	const isLoading =
		projectsQuery.isPending || auditQuery.isPending || !projectsQuery.data;

	const auditByV1Id = new Map<string, AuditLogEntry>();
	for (const row of auditQuery.data ?? []) {
		if (row.kind !== "project") continue;
		auditByV1Id.set(row.v1Id, {
			v2Id: row.v2Id,
			status: row.status,
			reason: row.reason,
		});
	}

	const projects = projectsQuery.data ?? [];

	const refresh = async () => {
		setIsRefreshing(true);
		try {
			await Promise.all([
				projectsQuery.refetch(),
				auditQuery.refetch(),
				cloudProjectsQuery.refetch(),
				queryClient.invalidateQueries({ queryKey: FIND_BY_PATH_KEY_PREFIX }),
			]);
		} finally {
			setIsRefreshing(false);
		}
	};

	return (
		<ImportPageShell
			title="Bring over your projects"
			description="Import each v1 project into v2. Already-imported projects show as Imported."
			isLoading={isLoading}
			itemCount={projects.length}
			emptyMessage="No v1 projects found on this device."
			onRefresh={refresh}
			isRefreshing={isRefreshing}
		>
			{projects.map((project) => (
				<ProjectRow
					key={project.id}
					project={project}
					audit={auditByV1Id.get(project.id)}
					liveProjectIds={liveProjectIds}
					organizationId={organizationId}
					activeHostUrl={activeHostUrl}
				/>
			))}
		</ImportPageShell>
	);
}

interface ProjectRowProps {
	project: {
		id: string;
		name: string;
		mainRepoPath: string;
		githubOwner: string | null;
	};
	audit: AuditLogEntry | undefined;
	/** Live cloud project ids in the org. `null` while still loading. */
	liveProjectIds: Set<string> | null;
	organizationId: string;
	activeHostUrl: string;
}

/**
 * Detects host-service `project.setup` CONFLICT thrown when the v2 project
 * is already registered at a different folder on this device. The server
 * supports `allowRelocate: true` to repoint, but only with explicit caller
 * consent — so we surface a confirm instead of silently relocating.
 */
function isAlreadySetUpElsewhereError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return err.message.includes("Project is already set up on this device at");
}

/** Pulls the existing repo path out of the server's CONFLICT message. */
function extractExistingPath(message: string): string | null {
	const match = message.match(
		/already set up on this device at (.+?)\.\s+Remove/,
	);
	return match?.[1] ?? null;
}

function expectedRemoteUrlFor(project: {
	name: string;
	mainRepoPath: string;
	githubOwner: string | null;
}): string | undefined {
	if (!project.githubOwner) return undefined;
	// v1 doesn't store the repo name explicitly. Use the basename of the
	// repo path (which is `git rev-parse --show-toplevel`'s last segment
	// for any clone) — more reliable than the project's display name,
	// which users can rename.
	const repoName = project.mainRepoPath.split("/").filter(Boolean).pop();
	if (!repoName) return undefined;
	return `https://github.com/${project.githubOwner}/${repoName}`;
}

function ProjectRow({
	project,
	audit,
	liveProjectIds,
	organizationId,
	activeHostUrl,
}: ProjectRowProps) {
	const queryClient = useQueryClient();
	const finalizeSetup = useFinalizeProjectSetup();
	const upsertState = electronTrpc.migration.upsertState.useMutation();
	const trpcUtils = electronTrpc.useUtils();
	const [running, setRunning] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [pendingRelocate, setPendingRelocate] = useState<{
		v2ProjectId: string;
		message: string;
	} | null>(null);

	// Audit says we already imported, but the v2 project may have been
	// deleted from cloud (by another device or user) since. Demote to
	// "available to import" when we can confirm cloud no longer has it.
	const auditClaimsImported =
		audit !== undefined &&
		(audit.status === "success" || audit.status === "linked");
	const auditGhost =
		auditClaimsImported &&
		liveProjectIds !== null &&
		(!audit?.v2Id || !liveProjectIds.has(audit.v2Id));
	const auditImported = auditClaimsImported && !auditGhost;
	const auditError =
		audit !== undefined && audit.status === "error" ? audit.reason : null;

	const expectedRemoteUrl = expectedRemoteUrlFor(project);

	const findByPathQuery = useQuery({
		queryKey: [
			...FIND_BY_PATH_KEY_PREFIX,
			project.mainRepoPath,
			expectedRemoteUrl ?? "",
			activeHostUrl,
		],
		queryFn: async () => {
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.project.findByPath.query({
				repoPath: project.mainRepoPath,
				expectedRemoteUrl,
			});
		},
		enabled: !auditImported,
		retry: false,
	});

	const runImport = async (
		linkToProjectId?: string,
		options: { allowRelocate?: boolean } = {},
	) => {
		setRunning(true);
		setErrorMessage(null);
		setPendingRelocate(null);
		try {
			const client = getHostServiceClientByUrl(activeHostUrl);
			const candidates = findByPathQuery.data?.candidates ?? [];

			let v2ProjectId: string;
			let mainWorkspaceId: string | null = null;
			let repoPath = project.mainRepoPath;
			let status: "success" | "linked";

			const targetCandidate = linkToProjectId
				? candidates.find((c) => c.id === linkToProjectId)
				: candidates[0];

			if (targetCandidate) {
				try {
					const result = await client.project.setup.mutate({
						projectId: targetCandidate.id,
						mode: {
							kind: "import",
							repoPath: project.mainRepoPath,
							allowRelocate: options.allowRelocate ?? false,
						},
					});
					v2ProjectId = targetCandidate.id;
					mainWorkspaceId = result.mainWorkspaceId;
					repoPath = result.repoPath;
					status = "linked";
				} catch (err) {
					// Setup throws CONFLICT when the v2 project is already set
					// up at a different folder on this device. Surface a
					// confirm so the user can opt in to repointing instead of
					// silently failing.
					if (isAlreadySetUpElsewhereError(err) && !options.allowRelocate) {
						setPendingRelocate({
							v2ProjectId: targetCandidate.id,
							message: err instanceof Error ? err.message : String(err),
						});
						setRunning(false);
						return;
					}
					throw err;
				}
			} else {
				const result = await client.project.create.mutate({
					name: project.name,
					mode: { kind: "importLocal", repoPath: project.mainRepoPath },
				});
				v2ProjectId = result.projectId;
				mainWorkspaceId = result.mainWorkspaceId;
				repoPath = result.repoPath;
				status = "success";
			}

			await upsertState.mutateAsync({
				v1Id: project.id,
				kind: "project",
				v2Id: v2ProjectId,
				organizationId,
				status,
				reason: null,
			});

			finalizeSetup(activeHostUrl, {
				projectId: v2ProjectId,
				repoPath,
				mainWorkspaceId,
			});

			await trpcUtils.migration.listState.invalidate({ organizationId });
			await queryClient.invalidateQueries({
				queryKey: [...FIND_BY_PATH_KEY_PREFIX, project.mainRepoPath],
			});
			// Crucial: cloudList is what the audit-ghost detector cross-
			// checks against. Without invalidating, the freshly-created v2
			// project isn't in the cached set and the row gets demoted from
			// "Imported" back to "available" — looks like the import didn't
			// finish even though it did.
			await queryClient.invalidateQueries({
				queryKey: PROJECT_CLOUD_LIST_KEY,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setErrorMessage(message);
			await upsertState
				.mutateAsync({
					v1Id: project.id,
					kind: "project",
					v2Id: null,
					organizationId,
					status: "error",
					reason: message,
				})
				.catch(() => {});
			await trpcUtils.migration.listState.invalidate({ organizationId });
		} finally {
			setRunning(false);
		}
	};

	const action: RowAction = (() => {
		if (running) return { kind: "running" };
		if (pendingRelocate) {
			const existingPath = extractExistingPath(pendingRelocate.message);
			const message = existingPath
				? `Already set up at ${existingPath}. Link to ${project.mainRepoPath} instead?`
				: `Link to ${project.mainRepoPath}?`;
			return {
				kind: "confirm",
				message,
				confirmLabel: "Use this folder",
				cancelLabel: "Cancel",
				onConfirm: () => {
					void runImport(pendingRelocate.v2ProjectId, {
						allowRelocate: true,
					});
				},
				onCancel: () => setPendingRelocate(null),
			};
		}
		if (auditImported) {
			return {
				kind: "imported",
				label: audit?.status === "linked" ? "Linked" : "Imported",
			};
		}
		if (errorMessage) {
			return {
				kind: "error",
				message: errorMessage,
				onRetry: () => runImport(),
			};
		}
		if (auditError) {
			return {
				kind: "error",
				message: auditError,
				onRetry: () => runImport(),
			};
		}
		if (findByPathQuery.isPending) return { kind: "running" };
		if (findByPathQuery.isError) {
			const message =
				findByPathQuery.error instanceof Error
					? findByPathQuery.error.message
					: String(findByPathQuery.error);
			return {
				kind: "error",
				message,
				onRetry: () => {
					void findByPathQuery.refetch();
				},
			};
		}
		const candidates = findByPathQuery.data?.candidates ?? [];
		const cloudErrors = findByPathQuery.data?.cloudErrors ?? [];
		// If we got nothing from cloud AND any cloud query failed, surface
		// the failure rather than offering Import (which would silently
		// create a duplicate v2 project on next sync).
		if (candidates.length === 0 && cloudErrors.length > 0) {
			const first = cloudErrors[0];
			return {
				kind: "error",
				message: first
					? `Couldn't reach cloud for ${first.url}: ${first.message}`
					: "Couldn't reach cloud",
				onRetry: () => {
					void findByPathQuery.refetch();
				},
			};
		}
		if (candidates.length > 1) {
			return {
				kind: "pick",
				label: "Link to…",
				candidates,
				onPick: (id) => {
					void runImport(id);
				},
			};
		}
		return {
			kind: "ready",
			label: candidates.length === 1 ? "Link" : "Import",
			onClick: () => {
				void runImport();
			},
		};
	})();

	return (
		<ImportRow
			icon={<LuFolder className="size-3.5" strokeWidth={2} />}
			primary={project.name}
			secondary={project.mainRepoPath}
			action={action}
		/>
	);
}
