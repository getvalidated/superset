"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { trpcClient } from "../../trpc/client";

interface WorkspaceRow {
	id: string;
	name: string;
	branch: string;
	projectName: string;
	hostId: string;
}

interface ProjectRow {
	id: string;
	name: string;
}

export default function WorkspacesPage() {
	const [organizationId, setOrganizationId] = useState<string | null>(null);
	const [organizationName, setOrganizationName] = useState<string | null>(null);
	const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
	const [projects, setProjects] = useState<ProjectRow[]>([]);
	const [error, setError] = useState<string | null>(null);

	const [name, setName] = useState("");
	const [branch, setBranch] = useState("");
	const [projectId, setProjectId] = useState("");
	const [hostId, setHostId] = useState("");
	const [creating, setCreating] = useState(false);

	const loadWorkspaces = useCallback(async (organization: string) => {
		const rows = await trpcClient.v2Workspace.list.query({
			organizationId: organization,
		});
		setWorkspaces(
			rows.map((row) => ({
				id: row.id,
				name: row.name,
				branch: row.branch,
				projectName: row.projectName,
				hostId: row.hostId,
			})),
		);
	}, []);

	useEffect(() => {
		(async () => {
			try {
				const organization = await trpcClient.organization.getActive.query();
				if (!organization) {
					setError("No active organization.");
					setWorkspaces([]);
					return;
				}
				setOrganizationId(organization.id);
				setOrganizationName(organization.name);
				const [, projectRows] = await Promise.all([
					loadWorkspaces(organization.id),
					trpcClient.v2Project.list.query({
						organizationId: organization.id,
					}),
				]);
				setProjects(
					projectRows.map((project) => ({
						id: project.id,
						name: project.name,
					})),
				);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
				setWorkspaces([]);
			}
		})();
	}, [loadWorkspaces]);

	const hostOptions = Array.from(
		new Set((workspaces ?? []).map((workspace) => workspace.hostId)),
	);

	const canCreate =
		!!organizationId &&
		!!projectId &&
		!!hostId &&
		name.trim().length > 0 &&
		branch.trim().length > 0 &&
		!creating;

	const createWorkspace = useCallback(async () => {
		if (!organizationId) return;
		setCreating(true);
		setError(null);
		try {
			await trpcClient.v2Workspace.create.mutate({
				organizationId,
				projectId,
				name: name.trim(),
				branch: branch.trim(),
				hostId,
			});
			setName("");
			setBranch("");
			await loadWorkspaces(organizationId);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setCreating(false);
		}
	}, [organizationId, projectId, name, branch, hostId, loadWorkspaces]);

	return (
		<div className="mx-auto min-h-[100dvh] max-w-3xl px-5 py-8">
			<h1 className="text-xl font-medium">Workspaces</h1>
			{organizationName && (
				<p className="text-muted-foreground mt-1 text-sm">{organizationName}</p>
			)}

			{error && (
				<p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
					{error}
				</p>
			)}

			<section className="mt-6 rounded-lg border p-4">
				<h2 className="text-sm font-medium">New workspace</h2>
				<div className="mt-3 grid gap-2 sm:grid-cols-2">
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Name"
						className="rounded-md border bg-transparent px-3 py-2 text-sm"
					/>
					<input
						value={branch}
						onChange={(event) => setBranch(event.target.value)}
						placeholder="Branch"
						className="rounded-md border bg-transparent px-3 py-2 text-sm"
					/>
					<select
						value={projectId}
						onChange={(event) => setProjectId(event.target.value)}
						className="rounded-md border bg-transparent px-3 py-2 text-sm"
					>
						<option value="">Select project…</option>
						{projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.name}
							</option>
						))}
					</select>
					<select
						value={hostId}
						onChange={(event) => setHostId(event.target.value)}
						className="rounded-md border bg-transparent px-3 py-2 text-sm"
					>
						<option value="">Select host…</option>
						{hostOptions.map((host) => (
							<option key={host} value={host}>
								{host}
							</option>
						))}
					</select>
				</div>
				{hostOptions.length === 0 && (
					<p className="text-muted-foreground mt-2 text-xs">
						No hosts available — register a machine in the desktop app first.
					</p>
				)}
				<button
					type="button"
					onClick={() => void createWorkspace()}
					disabled={!canCreate}
					className="bg-primary text-primary-foreground mt-3 rounded-md px-3 py-2 text-sm disabled:opacity-50"
				>
					{creating ? "Creating…" : "Create workspace"}
				</button>
			</section>

			<section className="mt-6">
				<h2 className="text-sm font-medium">Your workspaces</h2>
				{workspaces === null ? (
					<p className="text-muted-foreground mt-2 text-sm">Loading…</p>
				) : workspaces.length === 0 ? (
					<p className="text-muted-foreground mt-2 text-sm">
						No workspaces yet.
					</p>
				) : (
					<ul className="mt-2 grid gap-2">
						{workspaces.map((workspace) => (
							<li key={workspace.id}>
								<Link
									href={`/workspaces/${workspace.id}`}
									className="hover:bg-muted/50 block rounded-lg border px-4 py-3"
								>
									<div className="text-sm font-medium">{workspace.name}</div>
									<div className="text-muted-foreground mt-0.5 text-xs">
										{workspace.projectName} · {workspace.branch}
									</div>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
