import { Button } from "@superset/ui/button";
import { Checkbox } from "@superset/ui/checkbox";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { GoIssueClosed, GoIssueOpened } from "react-icons/go";
import { HiOutlineArrowTopRightOnSquare } from "react-icons/hi2";
import { LuPlus } from "react-icons/lu";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import {
	type LinkedIssue,
	useNewWorkspaceDraftStore,
} from "renderer/stores/new-workspace-draft";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";

interface GitHubIssuesContentProps {
	projectFilter: string | null;
	searchQuery: string;
	sectioned?: boolean;
}

export function GitHubIssuesContent({
	projectFilter,
	searchQuery,
	sectioned = false,
}: GitHubIssuesContentProps) {
	const [showClosed, setShowClosed] = useState(false);
	const showClosedId = useId();
	const debouncedQuery = useDebouncedValue(searchQuery, 300);
	const hostUrl = useHostUrl(null);
	const updateDraft = useNewWorkspaceDraftStore((s) => s.updateDraft);
	const resetDraft = useNewWorkspaceDraftStore((s) => s.resetDraft);
	const openModal = useOpenNewWorkspaceModal();

	const { data, isFetching, error } = useQuery({
		queryKey: [
			"tasks",
			"searchGitHubIssues",
			projectFilter,
			hostUrl,
			debouncedQuery.trim(),
			showClosed,
		],
		queryFn: async () => {
			if (!hostUrl || !projectFilter) return { issues: [] };
			const client = getHostServiceClientByUrl(hostUrl);
			return client.workspaceCreation.searchGitHubIssues.query({
				projectId: projectFilter,
				query: debouncedQuery.trim() || undefined,
				limit: 50,
				includeClosed: showClosed,
			});
		},
		enabled: !!projectFilter && !!hostUrl,
		retry: false,
	});

	const issues = useMemo(() => data?.issues ?? [], [data]);
	const repoMismatch =
		data && "repoMismatch" in data ? data.repoMismatch : null;

	const handleAddToWorkspace = (issue: (typeof issues)[number]) => {
		if (!projectFilter) return;
		const linkedIssue: LinkedIssue = {
			slug: `gh-${issue.issueNumber}`,
			title: issue.title,
			source: "github",
			url: issue.url,
			number: issue.issueNumber,
			state: issue.state.toLowerCase() === "closed" ? "closed" : "open",
		};
		resetDraft();
		updateDraft({
			selectedProjectId: projectFilter,
			linkedIssues: [linkedIssue],
		});
		openModal(projectFilter);
	};

	const handleOpenUrl = (url: string) => {
		window.open(url, "_blank", "noopener,noreferrer");
	};

	if (!projectFilter) {
		return (
			<div className="flex-1 flex items-center justify-center p-8">
				<div className="flex flex-col items-center gap-2 text-muted-foreground text-center">
					<GoIssueOpened className="h-8 w-8" />
					<span className="text-sm">Select a project to see issues.</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col min-h-0">
			{sectioned && (
				<div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
					<GoIssueOpened className="size-3.5 text-muted-foreground" />
					<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						GitHub issues
					</span>
					<span className="text-xs text-muted-foreground tabular-nums">
						{issues.length}
					</span>
				</div>
			)}

			<div className="flex items-center gap-2 px-4 py-1.5 border-b text-xs">
				<Checkbox
					id={showClosedId}
					checked={showClosed}
					onCheckedChange={(checked) => setShowClosed(checked === true)}
				/>
				<label
					htmlFor={showClosedId}
					className="cursor-pointer select-none text-muted-foreground"
				>
					Show closed
				</label>
				{isFetching && (
					<span className="ml-auto text-muted-foreground">Loading…</span>
				)}
			</div>

			{error instanceof Error && (
				<div className="px-4 py-3 text-sm text-destructive select-text cursor-text">
					{error.message}
				</div>
			)}

			{repoMismatch && (
				<div className="px-4 py-3 text-sm text-muted-foreground">
					Issue URL must match {repoMismatch}.
				</div>
			)}

			{issues.length === 0 && !isFetching && !error ? (
				<div className="flex-1 flex items-center justify-center p-8">
					<span className="text-sm text-muted-foreground">
						{showClosed ? "No issues found." : "No open issues."}
					</span>
				</div>
			) : (
				<div className="flex flex-col">
					{issues.map((issue) => {
						const isClosed = issue.state.toLowerCase() === "closed";
						const StateIcon = isClosed ? GoIssueClosed : GoIssueOpened;
						return (
							// biome-ignore lint/a11y/useSemanticElements: row contains nested action buttons, so the outer element is a div with role/tabIndex
							<div
								key={issue.issueNumber}
								className="group flex items-center gap-3 px-4 py-2 border-b hover:bg-accent/40 cursor-pointer"
								onClick={() => handleOpenUrl(issue.url)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										handleOpenUrl(issue.url);
									}
								}}
								role="button"
								tabIndex={0}
							>
								<StateIcon
									className={
										isClosed
											? "size-4 shrink-0 text-violet-500"
											: "size-4 shrink-0 text-emerald-500"
									}
								/>
								<span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
									#{issue.issueNumber}
								</span>
								<span className="min-w-0 flex-1 truncate text-sm">
									{issue.title}
								</span>
								{issue.authorLogin && (
									<span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
										{issue.authorLogin}
									</span>
								)}
								<div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
									<Button
										variant="ghost"
										size="icon-xs"
										title="Open in browser"
										onClick={(e) => {
											e.stopPropagation();
											handleOpenUrl(issue.url);
										}}
									>
										<HiOutlineArrowTopRightOnSquare className="size-3.5" />
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="h-7 gap-1.5 px-2 text-xs"
										onClick={(e) => {
											e.stopPropagation();
											handleAddToWorkspace(issue);
										}}
									>
										<LuPlus className="size-3.5" />
										Add to workspace
									</Button>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
