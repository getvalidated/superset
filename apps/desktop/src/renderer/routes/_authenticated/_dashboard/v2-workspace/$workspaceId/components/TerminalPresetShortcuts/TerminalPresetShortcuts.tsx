import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { workspaceTrpc } from "@superset/workspace-client";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Settings } from "lucide-react";
import { useCallback, useMemo } from "react";
import { HiMiniCommandLine } from "react-icons/hi2";
import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import { resolvePresetLaunchCommands } from "renderer/lib/agent-launch-command";
import { resolveV2PresetIcon } from "renderer/lib/preset-icon";
import {
	buildTerminalCommand,
	normalizeTerminalCommand,
} from "renderer/lib/terminal/launch-command";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import { filterMatchingPresetsForProject } from "shared/preset-project-targeting";
import { quote } from "shell-quote";

interface TerminalPresetShortcutsProps {
	workspaceId: string;
	terminalId: string;
	projectId: string | null;
}

function isPresetVisibleInBar(pinnedToBar: boolean | undefined): boolean {
	// Same compatibility rule as V2PresetsBar: undefined defaults to visible.
	return pinnedToBar !== false;
}

/**
 * Compact preset launcher for a terminal header: one icon button per visible
 * preset plus a manage gear, mirroring the presets bar but scoped to a single
 * terminal — clicking a preset runs its command in *this* terminal instead of
 * opening a new pane. Rendered in the tabs-mode pane header and in canvas
 * terminal window title bars, so it must stay icon-sized.
 *
 * Must render under a workspace-scoped WorkspaceClientProvider (tabs-mode pane
 * tree or CanvasHostProvider) so writeInput reaches the owning host.
 */
export function TerminalPresetShortcuts({
	workspaceId,
	terminalId,
	projectId,
}: TerminalPresetShortcutsProps) {
	const navigate = useNavigate();
	const isDark = useIsDarkTheme();
	const collections = useCollections();
	const { activeHostUrl } = useLocalHostService();
	const { data: agents } = useV2AgentConfigs(activeHostUrl);
	const writeInput = workspaceTrpc.terminal.writeInput.useMutation();
	const workspaceQuery = workspaceTrpc.workspace.get.useQuery(
		{ id: workspaceId },
		{ refetchOnWindowFocus: false, retry: false },
	);
	const worktreePath = workspaceQuery.data?.worktreePath;

	const { data: allPresets = [] } = useLiveQuery(
		(query) =>
			query
				.from({ v2TerminalPresets: collections.v2TerminalPresets })
				.orderBy(({ v2TerminalPresets }) => v2TerminalPresets.tabOrder),
		[collections],
	);
	const matchedPresets = useMemo(
		() => filterMatchingPresetsForProject(allPresets, projectId),
		[allPresets, projectId],
	);
	const visiblePresets = useMemo(
		() =>
			matchedPresets.filter((preset) =>
				isPresetVisibleInBar(preset.pinnedToBar),
			),
		[matchedPresets],
	);

	const runPresetInTerminal = useCallback(
		(preset: V2TerminalPresetRow) => {
			const command = buildTerminalCommand(
				resolvePresetLaunchCommands(preset, agents),
			);
			if (!command) return;
			const cwd = preset.cwd?.trim();
			const resolvedCwd =
				cwd && worktreePath ? toAbsoluteWorkspacePath(worktreePath, cwd) : cwd;
			const data = normalizeTerminalCommand(
				resolvedCwd ? `cd ${quote([resolvedCwd])} && ${command}` : command,
			);
			writeInput.mutate(
				{ terminalId, workspaceId, data },
				{
					onError: (error) => {
						toast.error("Failed to run preset", {
							description: error.message,
						});
					},
				},
			);
		},
		[agents, terminalId, workspaceId, worktreePath, writeInput],
	);

	const handleTogglePresetVisibility = useCallback(
		(presetId: string, nextVisible: boolean) => {
			collections.v2TerminalPresets.update(presetId, (draft) => {
				draft.pinnedToBar = nextVisible;
			});
		},
		[collections.v2TerminalPresets],
	);

	return (
		<div className="flex items-center gap-0.5">
			{visiblePresets.map((preset) => {
				const icon = resolveV2PresetIcon(preset, agents, isDark);
				const label = preset.name || "default";
				return (
					<Tooltip key={preset.id}>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={() => runPresetInTerminal(preset)}
								aria-label={`Run ${label} in this terminal`}
								className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								{icon ? (
									<img
										src={icon}
										alt=""
										className="size-3.5 object-contain opacity-90"
									/>
								) : (
									<HiMiniCommandLine className="size-3.5" />
								)}
							</button>
						</TooltipTrigger>
						<TooltipContent side="bottom" sideOffset={4} showArrow={false}>
							Run {label} in this terminal
						</TooltipContent>
					</Tooltip>
				);
			})}
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label="Manage presets"
								className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<Settings className="size-3.5" />
							</button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={4} showArrow={false}>
						Manage Presets
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" className="w-56">
					{matchedPresets.map((preset) => {
						const icon = resolveV2PresetIcon(preset, agents, isDark);
						const isVisible = isPresetVisibleInBar(preset.pinnedToBar);
						return (
							<DropdownMenuItem
								key={preset.id}
								className="gap-2"
								onSelect={(event) => {
									event.preventDefault();
									handleTogglePresetVisibility(preset.id, !isVisible);
								}}
							>
								{icon ? (
									<img src={icon} alt="" className="size-4 object-contain" />
								) : (
									<HiMiniCommandLine className="size-4" />
								)}
								<span className="min-w-0 flex-1 truncate">
									{preset.name || "default"}
								</span>
								{isVisible ? (
									<Eye className="size-3.5 text-foreground" />
								) : (
									<EyeOff className="size-3.5 text-muted-foreground/60" />
								)}
							</DropdownMenuItem>
						);
					})}
					{matchedPresets.length > 0 ? <DropdownMenuSeparator /> : null}
					<DropdownMenuItem
						className="gap-2"
						onClick={() => navigate({ to: "/settings/terminal" })}
					>
						<Settings className="size-4" />
						<span>Manage Presets</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
