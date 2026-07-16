import { Workspace } from "@superset/panes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { workspaceTrpc } from "@superset/workspace-client";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useQuickOpenStore } from "renderer/commandPalette/ui/QuickOpen/quickOpenStore";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { useHotkey } from "renderer/hotkeys";
import { useEffectiveWorkspaceId } from "renderer/routes/_authenticated/_dashboard/hooks/useEffectiveWorkspaceId";
import { CommandPalette } from "renderer/screens/main/components/CommandPalette";
import { ResizablePanel } from "renderer/screens/main/components/ResizablePanel";
import { getV2NotificationSourcesForTab } from "renderer/stores/v2-notifications";
import { CanvasView } from "../canvas";
import { useWorkspace } from "../providers/WorkspaceProvider";
import { AddTabMenu } from "./components/AddTabMenu";
import { BackgroundTerminalsButton } from "./components/BackgroundTerminalsButton";
import { V2NotificationStatusIndicator } from "./components/V2NotificationStatusIndicator";
import { V2PresetsBar } from "./components/V2PresetsBar";
import { V2WorkspaceRunButton } from "./components/V2WorkspaceRunButton";
import { WorkspaceEmptyState } from "./components/WorkspaceEmptyState";
import { WorkspaceMissingWorktreeState } from "./components/WorkspaceMissingWorktreeState";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { useBrowserShellInteractionPassthrough } from "./hooks/useBrowserShellInteractionPassthrough";
import { useCanvasWindowOpeners } from "./hooks/useCanvasWindowOpeners";
import { useClearActivePaneAttention } from "./hooks/useClearActivePaneAttention";
import { useConsumeAutomationRunLink } from "./hooks/useConsumeAutomationRunLink";
import { useConsumeOpenUrlRequest } from "./hooks/useConsumeOpenUrlRequest";
import { useDefaultContextMenuActions } from "./hooks/useDefaultContextMenuActions";
import { useDefaultPaneActions } from "./hooks/useDefaultPaneActions";
import { usePaneRegistry } from "./hooks/usePaneRegistry";
import { renderBrowserTabIcon } from "./hooks/usePaneRegistry/components/BrowserPane";
import { useSlotElement } from "./hooks/useSlotElement";
import { useTabCloseGuard } from "./hooks/useTabCloseGuard";
import { useV2PresetExecution } from "./hooks/useV2PresetExecution";
import { useV2TerminalLauncher } from "./hooks/useV2TerminalLauncher";
import { useV2WorkspacePaneLayout } from "./hooks/useV2WorkspacePaneLayout";
import { useV2WorkspaceRun } from "./hooks/useV2WorkspaceRun";
import { useWorkspaceFileNavigation } from "./hooks/useWorkspaceFileNavigation";
import { useWorkspaceHotkeys } from "./hooks/useWorkspaceHotkeys";
import { useWorkspacePaneOpeners } from "./hooks/useWorkspacePaneOpeners";
import { WorkspaceGitStatusProvider } from "./providers/WorkspaceGitStatusProvider";
import { FileDocumentStoreProvider } from "./state/fileDocumentStore";
import type { PaneViewerData } from "./types";
import type { V2WorkspaceUrlOpenTarget } from "./utils/openUrlInV2Workspace";

interface WorkspaceSearch {
	terminalId?: string;
	chatSessionId?: string;
	focusRequestId?: string;
	openUrl?: string;
	openUrlTarget?: V2WorkspaceUrlOpenTarget;
	openUrlRequestId?: string;
}

function parseOpenUrlTarget(
	value: unknown,
): V2WorkspaceUrlOpenTarget | undefined {
	if (value === "current-tab" || value === "new-tab") return value;
	return undefined;
}

function parseNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-workspace/$workspaceId/",
)({
	component: V2WorkspacePage,
	validateSearch: (raw: Record<string, unknown>): WorkspaceSearch => ({
		terminalId: parseNonEmptyString(raw.terminalId),
		chatSessionId: parseNonEmptyString(raw.chatSessionId),
		focusRequestId: parseNonEmptyString(raw.focusRequestId),
		openUrl: parseNonEmptyString(raw.openUrl),
		openUrlTarget: parseOpenUrlTarget(raw.openUrlTarget),
		openUrlRequestId: parseNonEmptyString(raw.openUrlRequestId),
	}),
});

function V2WorkspacePage() {
	const { workspace } = useWorkspace();
	const workspaceStatusQuery = workspaceTrpc.workspace.get.useQuery(
		{ id: workspace.id },
		{
			refetchOnWindowFocus: true,
			retry: false,
		},
	);

	if (workspaceStatusQuery.data?.worktreeExists === false) {
		return (
			<WorkspaceMissingWorktreeState
				workspaceId={workspace.id}
				workspaceName={workspace.name}
				branch={workspace.branch}
				worktreePath={workspaceStatusQuery.data?.worktreePath}
				onRefresh={() => {
					void workspaceStatusQuery.refetch();
				}}
				isRefreshing={workspaceStatusQuery.isFetching}
			/>
		);
	}

	return <V2WorkspaceContent />;
}

// Hooks that only act on the tabbed layout — hotkeys drive it and attention
// clearing targets its active pane. Mounted only in tabs mode so they stay
// inert while the canvas is showing the hidden store.
function TabbedWorkspaceEffects(
	props: Parameters<typeof useWorkspaceHotkeys>[0],
) {
	useClearActivePaneAttention({ store: props.store });
	useWorkspaceHotkeys(props);
	return null;
}

function V2WorkspaceContent() {
	const {
		terminalId,
		chatSessionId,
		focusRequestId,
		openUrl,
		openUrlTarget,
		openUrlRequestId,
	} = Route.useSearch();
	const { workspace } = useWorkspace();
	const workspaceId = workspace.id;
	// The sidebar (files/changes/review/PR) and its git status describe the
	// workspace the user is actually looking at — on the canvas that's the
	// focused window's workspace, not necessarily the route's.
	const sidebarWorkspaceId = useEffectiveWorkspaceId(workspaceId);

	const {
		preferences: v2UserPreferences,
		setRightSidebarOpen,
		setRightSidebarTab,
		setRightSidebarWidth,
		setShowPresetsBar,
		setDisplayMode,
	} = useV2UserPreferences();
	const showPresetsBar = v2UserPreferences.showPresetsBar;
	const sidebarOpen = v2UserPreferences.rightSidebarOpen;
	// Older persisted rows read displayMode as undefined (live reads skip zod
	// defaults) — treat that as tabs.
	const displayMode = v2UserPreferences.displayMode ?? "tabs";
	const { store } = useV2WorkspacePaneLayout();
	const launcher = useV2TerminalLauncher();
	const {
		matchedPresets,
		newTabPresets,
		executePreset,
		resolvePresetCommands,
	} = useV2PresetExecution({
		store,
		launcher,
	});
	const workspaceRun = useV2WorkspaceRun({
		store,
		launcher,
		matchedPresets,
		resolvePresetCommands,
	});
	useConsumeAutomationRunLink({
		store,
		workspaceId,
		terminalId,
		chatSessionId,
		focusRequestId,
		enabled: displayMode === "tabs",
	});
	useConsumeOpenUrlRequest({
		store,
		url: openUrl,
		target: openUrlTarget,
		requestId: openUrlRequestId,
		enabled: displayMode === "tabs",
	});

	const {
		openFilePaneFromTreeClick,
		revealPath,
		selectedFilePath,
		pendingReveal,
		recentFiles,
		openFilePaths,
	} = useWorkspaceFileNavigation({
		store,
		setRightSidebarOpen,
		setRightSidebarTab,
	});

	const paneRegistry = usePaneRegistry({
		onOpenFile: openFilePaneFromTreeClick,
		onRevealPath: revealPath,
		launcher,
		store,
	});
	const defaultContextMenuActions = useDefaultContextMenuActions({
		paneRegistry,
		launcher,
	});
	const {
		openDiffPane,
		addTerminalTab,
		addChatTab,
		addBrowserTab,
		openCommentPane,
	} = useWorkspacePaneOpeners({
		store,
		launcher,
		newTabPresets,
		executePreset,
	});

	const quickOpenOpen = useQuickOpenStore(
		(s) => s.open && s.target?.workspaceId === workspaceId,
	);
	const closeQuickOpen = useQuickOpenStore((s) => s.close);
	const openQuickOpenFor = useQuickOpenStore((s) => s.openFor);
	const handleQuickOpen = useCallback(
		() => openQuickOpenFor({ workspaceId }),
		[openQuickOpenFor, workspaceId],
	);
	const handleQuickOpenChange = useCallback(
		(next: boolean) => {
			if (!next) closeQuickOpen();
		},
		[closeQuickOpen],
	);
	// Sidebar/quick-open picks open panes in the tabbed layout; in canvas mode
	// they open free-floating windows on the global canvas instead. Quick-open
	// stays scoped to the route workspace (its file list is), while sidebar
	// picks target the workspace the sidebar is showing.
	const { openFileOnCanvas } = useCanvasWindowOpeners({ workspaceId });
	const {
		openFileOnCanvas: openSidebarFileOnCanvas,
		openDiffOnCanvas: openSidebarDiffOnCanvas,
		openCommentOnCanvas: openSidebarCommentOnCanvas,
	} = useCanvasWindowOpeners({ workspaceId: sidebarWorkspaceId });
	// Picking a file from Quick Open should surface the sidebar/Files tab so
	// the reveal (expand + highlight + scroll) is actually visible. On the
	// canvas there's no reveal to show — just open the window.
	const handleQuickOpenSelectFile = useCallback(
		(filePath: string, openInNewTab?: boolean) => {
			if (displayMode === "canvas") {
				openFileOnCanvas(filePath, openInNewTab);
				return;
			}
			setRightSidebarOpen(true);
			setRightSidebarTab("files");
			openFilePaneFromTreeClick(filePath, openInNewTab);
		},
		[
			displayMode,
			openFileOnCanvas,
			openFilePaneFromTreeClick,
			setRightSidebarOpen,
			setRightSidebarTab,
		],
	);
	const defaultPaneActions = useDefaultPaneActions({ launcher });
	const onBeforeCloseTab = useTabCloseGuard();

	const handleSidebarSelectFile = useCallback(
		(...args: Parameters<typeof openFilePaneFromTreeClick>) => {
			if (displayMode === "canvas") {
				openSidebarFileOnCanvas(...args);
				return;
			}
			openFilePaneFromTreeClick(...args);
		},
		[displayMode, openSidebarFileOnCanvas, openFilePaneFromTreeClick],
	);
	const handleSidebarSelectDiffFile = useCallback(
		(...args: Parameters<typeof openDiffPane>) => {
			if (displayMode === "canvas") {
				openSidebarDiffOnCanvas(...args);
				return;
			}
			openDiffPane(...args);
		},
		[displayMode, openSidebarDiffOnCanvas, openDiffPane],
	);
	const handleSidebarOpenComment = useCallback(
		(...args: Parameters<typeof openCommentPane>) => {
			if (displayMode === "canvas") {
				openSidebarCommentOnCanvas(...args);
				return;
			}
			openCommentPane(...args);
		},
		[displayMode, openSidebarCommentOnCanvas, openCommentPane],
	);

	// Fallback for rows persisted before the rightSidebarWidth field existed —
	// the live collection skips zod defaults, so an older row reads undefined
	// here and would render the ResizablePanel without a width (full-bleed).
	const sidebarWidth = v2UserPreferences.rightSidebarWidth ?? 340;
	const [isSidebarResizing, setIsSidebarResizing] = useState(false);
	const { onSidebarResizeDragging, onWorkspaceInteractionStateChange } =
		useBrowserShellInteractionPassthrough({ sidebarOpen });
	const handleSidebarResizingChange = useCallback(
		(resizing: boolean) => {
			setIsSidebarResizing(resizing);
			onSidebarResizeDragging(resizing);
		},
		[onSidebarResizeDragging],
	);

	// The sidebar slot lives at the dashboard layout level (next to TopBar) so
	// the sidebar runs full-height.
	const sidebarSlotEl = useSlotElement("workspace-right-sidebar-slot");
	// TopBar slot for the run button when the presets bar (its usual home) is
	// hidden. The button renders here via portal so it keeps this page's
	// context (pane store, workspace providers) while appearing in the TopBar.
	const runButtonSlotEl = useSlotElement("workspace-topbar-run-slot");

	useHotkey("QUICK_OPEN", handleQuickOpen);
	useHotkey("RUN_WORKSPACE_COMMAND", () => {
		void workspaceRun.toggleWorkspaceRun();
	});

	const workspaceRunButton = (
		<V2WorkspaceRunButton
			projectId={workspace.projectId}
			definition={workspaceRun.definition}
			isRunning={workspaceRun.isRunning}
			isPending={workspaceRun.isPending}
			canForceStop={workspaceRun.canForceStop}
			onToggle={workspaceRun.toggleWorkspaceRun}
			onForceStop={workspaceRun.forceStopWorkspaceRun}
		/>
	);

	return (
		<FileDocumentStoreProvider>
			{displayMode === "tabs" && (
				<TabbedWorkspaceEffects
					store={store}
					matchedPresets={matchedPresets}
					executePreset={executePreset}
					addTerminalTab={addTerminalTab}
					paneRegistry={paneRegistry}
					launcher={launcher}
					onBeforeCloseTab={onBeforeCloseTab}
				/>
			)}
			<WorkspaceGitStatusProvider
				workspaceId={sidebarWorkspaceId}
				store={store}
				sidebarOpen={sidebarOpen}
			>
				<div className="flex min-h-0 min-w-0 flex-1">
					<div
						className="flex min-h-0 min-w-[320px] flex-1 flex-col overflow-hidden"
						data-workspace-id={workspaceId}
					>
						{displayMode === "canvas" ? (
							<CanvasView onExit={() => setDisplayMode("tabs")} />
						) : (
							<Workspace<PaneViewerData>
								key={workspaceId}
								registry={paneRegistry}
								paneActions={defaultPaneActions}
								contextMenuActions={defaultContextMenuActions}
								renderTabIcon={renderBrowserTabIcon}
								renderTabAccessory={(tab) => (
									<V2NotificationStatusIndicator
										sources={getV2NotificationSourcesForTab(tab)}
									/>
								)}
								renderBelowTabBar={() =>
									showPresetsBar ? (
										<V2PresetsBar
											matchedPresets={matchedPresets}
											executePreset={executePreset}
											showPresetsBar={showPresetsBar}
											onToggleShowPresetsBar={setShowPresetsBar}
											trailing={workspaceRunButton}
										/>
									) : null
								}
								renderAddTabMenu={() => (
									<AddTabMenu
										onAddTerminal={addTerminalTab}
										onAddChat={addChatTab}
										onAddBrowser={addBrowserTab}
										showPresetsBar={showPresetsBar}
										onToggleShowPresetsBar={setShowPresetsBar}
									/>
								)}
								renderTabBarTrailing={() => (
									<div className="flex items-center gap-0.5">
										<BackgroundTerminalsButton
											workspaceId={workspaceId}
											store={store}
										/>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													onClick={() => setDisplayMode("canvas")}
													className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
												>
													<LayoutDashboard className="size-3.5" />
												</button>
											</TooltipTrigger>
											<TooltipContent side="bottom" showArrow={false}>
												Canvas view — all sessions on an infinite plane
											</TooltipContent>
										</Tooltip>
									</div>
								)}
								renderEmptyState={() => (
									<WorkspaceEmptyState
										onOpenBrowser={addBrowserTab}
										onOpenChat={addChatTab}
										onOpenQuickOpen={handleQuickOpen}
										onOpenTerminal={addTerminalTab}
									/>
								)}
								onBeforeCloseTab={onBeforeCloseTab}
								onInteractionStateChange={onWorkspaceInteractionStateChange}
								store={store}
							/>
						)}
					</div>
				</div>
				{(displayMode === "canvas" || !showPresetsBar) &&
					runButtonSlotEl &&
					createPortal(workspaceRunButton, runButtonSlotEl)}
				{sidebarOpen &&
					sidebarSlotEl &&
					createPortal(
						<ResizablePanel
							width={sidebarWidth}
							onWidthChange={setRightSidebarWidth}
							isResizing={isSidebarResizing}
							onResizingChange={handleSidebarResizingChange}
							minWidth={240}
							maxWidth={640}
							handleSide="left"
							onDoubleClickHandle={() => setRightSidebarWidth(340)}
						>
							<WorkspaceSidebar
								workspaceId={sidebarWorkspaceId}
								onSelectFile={handleSidebarSelectFile}
								onSelectDiffFile={handleSidebarSelectDiffFile}
								onOpenComment={handleSidebarOpenComment}
								onSearch={handleQuickOpen}
								selectedFilePath={selectedFilePath}
								pendingReveal={pendingReveal}
							/>
						</ResizablePanel>,
						sidebarSlotEl,
					)}
			</WorkspaceGitStatusProvider>
			<CommandPalette
				workspaceId={workspaceId}
				open={quickOpenOpen}
				onOpenChange={handleQuickOpenChange}
				onSelectFile={handleQuickOpenSelectFile}
				variant="v2"
				recentlyViewedFiles={recentFiles}
				openFilePaths={openFilePaths}
			/>
		</FileDocumentStoreProvider>
	);
}
