import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@superset/ui/alert-dialog";
import { toast } from "@superset/ui/sonner";
import { Spinner } from "@superset/ui/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LuFolder, LuX } from "react-icons/lu";
import { useEnsureV2Project } from "renderer/hooks/useEnsureV2Project";
import { useIsV2CloudEnabled } from "renderer/hooks/useIsV2CloudEnabled";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useFinalizeProjectSetup } from "renderer/react-query/projects/useFinalizeProjectSetup";
import { useOpenProject } from "renderer/react-query/projects/useOpenProject";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { STEP_ROUTES, useOnboardingStore } from "renderer/stores/onboarding";
import { SetupButton } from "../components/SetupButton";
import { StepHeader, StepShell, SupersetPill } from "../components/StepShell";
import { SupersetIcon } from "../providers/components/SupersetIcon";

export const Route = createFileRoute("/_authenticated/setup/project/")({
	component: OnboardingProjectPage,
});

function OnboardingProjectPage() {
	const navigate = useNavigate();
	const goTo = useOnboardingStore((s) => s.goTo);
	const markComplete = useOnboardingStore((s) => s.markComplete);
	const markSkipped = useOnboardingStore((s) => s.markSkipped);
	const setManualWalkthrough = useOnboardingStore(
		(s) => s.setManualWalkthrough,
	);

	const { data: projects, isPending } =
		electronTrpc.projects.getRecents.useQuery();
	const { openNew, isPending: isOpenPending } = useOpenProject();
	const utils = electronTrpc.useUtils();
	const isV2CloudEnabled = useIsV2CloudEnabled();
	const { activeHostUrl } = useLocalHostService();
	const ensureV2Project = useEnsureV2Project();
	const finalizeProjectSetup = useFinalizeProjectSetup();
	const [isContinuing, setIsContinuing] = useState(false);
	const v2NeedsHost = isV2CloudEnabled && !activeHostUrl;
	const closeProject = electronTrpc.projects.close.useMutation({
		onSuccess: async () => {
			await utils.projects.getRecents.invalidate();
		},
	});

	const handleRemoveProject = async (id: string, name: string) => {
		try {
			await closeProject.mutateAsync({ id });
			toast.success(`Removed ${name}`);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to remove project",
			);
		}
	};

	useEffect(() => {
		goTo("project");
	}, [goTo]);

	const projectCount = projects?.length ?? 0;
	const hasProjects = projectCount > 0;

	// In v1, navigate to the project's existing branch workspace (which has a
	// real layout). v2 users go straight to the just-created main workspace —
	// `/project/$projectId` is the v1-only page, so v2 must not route through
	// it from onboarding. Falls back to the v2 workspaces list when no main
	// workspace id is available (e.g. ensure-v2 returned a linked project that
	// the host couldn't construct a main workspace for).
	const openProjectInWorkspace = async (
		projectId: string,
		v2MainWorkspaceId: string | null,
	) => {
		if (isV2CloudEnabled) {
			if (v2MainWorkspaceId) {
				navigate({
					to: "/v2-workspace/$workspaceId",
					params: { workspaceId: v2MainWorkspaceId },
				});
				return;
			}
			navigate({ to: "/v2-workspaces" });
			return;
		}
		try {
			const grouped = await utils.workspaces.getAllGrouped.fetch();
			const wsForProject = grouped
				.flatMap((g) => g.workspaces)
				.find((w) => w.projectId === projectId);
			if (wsForProject) {
				navigate({
					to: "/workspace/$workspaceId",
					params: { workspaceId: wsForProject.id },
				});
				return;
			}
		} catch {
			// fall through
		}
		navigate({
			to: "/project/$projectId",
			params: { projectId },
		});
	};

	const handleSelectNewRepo = async () => {
		const created = await openNew();
		const project = created[0];
		if (!project) return;

		let navigateProjectId = project.id;
		let v2MainWorkspaceId: string | null = null;
		if (isV2CloudEnabled) {
			try {
				const result = await ensureV2Project({
					repoPath: project.mainRepoPath,
					name: project.name,
				});
				finalizeProjectSetup(result.hostUrl, {
					projectId: result.projectId,
					repoPath: result.repoPath,
					mainWorkspaceId: result.mainWorkspaceId,
				});
				navigateProjectId = result.projectId;
				v2MainWorkspaceId = result.mainWorkspaceId;
				await utils.projects.getRecents.invalidate();
			} catch (err) {
				toast.error(
					err instanceof Error
						? `Could not link to v2: ${err.message}`
						: "Could not link project to v2",
				);
				return;
			}
		}

		markComplete("project");
		setManualWalkthrough(false);
		await openProjectInWorkspace(navigateProjectId, v2MainWorkspaceId);
	};

	const handleContinueWithCurrent = async () => {
		if (isV2CloudEnabled && projects) {
			setIsContinuing(true);
			try {
				for (const project of projects) {
					const result = await ensureV2Project({
						repoPath: project.mainRepoPath,
						name: project.name,
					});
					finalizeProjectSetup(result.hostUrl, {
						projectId: result.projectId,
						repoPath: result.repoPath,
						mainWorkspaceId: result.mainWorkspaceId,
					});
				}
				await utils.projects.getRecents.invalidate();
			} catch (err) {
				toast.error(
					err instanceof Error
						? `Could not link projects to v2: ${err.message}`
						: "Could not link projects to v2",
				);
				setIsContinuing(false);
				return;
			}
			setIsContinuing(false);
		}
		markComplete("project");
		navigate({ to: STEP_ROUTES["adopt-worktrees"] });
	};

	const handleSkipStep = () => {
		markSkipped("project");
		navigate({ to: STEP_ROUTES["adopt-worktrees"] });
	};

	if (isPending) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-[#151110]">
				<Spinner className="size-6 text-[#a8a5a3]" />
			</div>
		);
	}

	const supersetIcon = (
		<SupersetPill>
			<div className="flex size-[48px] items-center justify-center rounded-[12px] bg-[#151110]">
				<SupersetIcon className="w-8" />
			</div>
		</SupersetPill>
	);

	if (hasProjects && projects) {
		return (
			<StepShell backTo={STEP_ROUTES.permissions}>
				<StepHeader
					icon={supersetIcon}
					title="Your projects"
					subtitle={`${projectCount} project${projectCount === 1 ? "" : "s"} attached. Continue or add another.`}
				/>

				<div className="overflow-hidden rounded-lg border border-[#2a2827] bg-[#201e1c]">
					<div className="max-h-[280px] divide-y divide-[#2a2827] overflow-y-auto">
						{projects.map((project) => (
							<div
								key={project.id}
								className="group flex items-center gap-3 px-4 py-3"
							>
								<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#151110] text-[#a8a5a3]">
									<LuFolder className="size-4" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate text-[12px] font-medium text-[#eae8e6]">
										{project.name}
									</p>
									<p className="truncate font-mono text-[10px] text-[#a8a5a3]">
										{project.mainRepoPath}
									</p>
								</div>
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<button
											type="button"
											aria-label={`Remove ${project.name}`}
											className="flex size-7 shrink-0 items-center justify-center rounded text-[#a8a5a3] opacity-0 transition-opacity hover:bg-white/5 hover:text-[#eae8e6] group-hover:opacity-100 focus-visible:opacity-100"
										>
											<LuX className="size-4" />
										</button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>
												Remove {project.name}?
											</AlertDialogTitle>
											<AlertDialogDescription>
												This removes the project and its tracked workspaces from
												Superset. The folder on disk and your git history are
												untouched — you can re-add it any time.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction
												onClick={() =>
													handleRemoveProject(project.id, project.name)
												}
											>
												Remove
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							</div>
						))}
					</div>
				</div>

				<div className="flex w-[273px] flex-col gap-2 self-center">
					<SetupButton
						onClick={handleContinueWithCurrent}
						disabled={isContinuing || isOpenPending || v2NeedsHost}
					>
						{isContinuing
							? "Linking…"
							: v2NeedsHost
								? "Connecting…"
								: "Continue with current"}
					</SetupButton>
					<SetupButton
						variant="secondary"
						onClick={handleSelectNewRepo}
						disabled={isOpenPending || isContinuing || v2NeedsHost}
					>
						{isOpenPending
							? "Opening…"
							: v2NeedsHost
								? "Connecting…"
								: "Select new repo"}
					</SetupButton>
					<SetupButton
						variant="secondary"
						onClick={() => navigate({ to: "/new-project" })}
						disabled={isContinuing || v2NeedsHost}
					>
						Clone from GitHub
					</SetupButton>
					<SetupButton
						variant="link"
						onClick={handleSkipStep}
						disabled={isContinuing}
					>
						Skip for now
					</SetupButton>
				</div>
			</StepShell>
		);
	}

	return (
		<StepShell backTo={STEP_ROUTES.permissions}>
			<StepHeader
				icon={supersetIcon}
				title="Select a repository"
				subtitle="Choose a local folder to start working with"
			/>

			<div className="flex w-[273px] flex-col gap-2 self-center">
				<SetupButton
					onClick={handleSelectNewRepo}
					disabled={isOpenPending || v2NeedsHost}
				>
					{isOpenPending
						? "Opening…"
						: v2NeedsHost
							? "Connecting…"
							: "Select new repo"}
				</SetupButton>
				<SetupButton
					variant="secondary"
					onClick={() => navigate({ to: "/new-project" })}
					disabled={v2NeedsHost}
				>
					Clone from GitHub
				</SetupButton>
				<SetupButton variant="link" onClick={handleSkipStep}>
					Skip for now
				</SetupButton>
			</div>
		</StepShell>
	);
}
