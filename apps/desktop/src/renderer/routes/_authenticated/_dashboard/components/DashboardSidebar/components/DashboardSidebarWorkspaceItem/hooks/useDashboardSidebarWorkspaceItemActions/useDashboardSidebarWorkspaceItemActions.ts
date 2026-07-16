import { toast } from "@superset/ui/sonner";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	useMarkWorkspaceTerminalsSeen,
	useV2WorkspaceIsUnread,
} from "renderer/hooks/host-service/useV2NotificationStatus";
import { useWorkspaceHostUrl } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { showHostServiceUnavailableToast } from "renderer/lib/host-service-unavailable";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useDashboardSidebarSectionRename } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarSectionRenameContext";
import {
	fitCanvasCameraToWorkspace,
	getGlobalCanvasStore,
	openWorkspaceTerminalOnCanvas,
	workspaceHasCanvasTerminal,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/canvas";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useOptimisticCollectionActions } from "renderer/routes/_authenticated/hooks/useOptimisticCollectionActions";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { V2_USER_PREFERENCES_ID } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useRemoveFromSidebarIntent } from "renderer/stores/remove-workspace-from-sidebar-intent";
import { useTheme } from "renderer/stores/theme";
import { resolveTerminalThemeType } from "renderer/stores/theme/utils";
import { useV2NotificationStore } from "renderer/stores/v2-notifications";

interface UseDashboardSidebarWorkspaceItemActionsOptions {
	workspaceId: string;
	projectId: string;
	workspaceName: string;
	branch: string;
	isMainWorkspace?: boolean;
}

export function useDashboardSidebarWorkspaceItemActions({
	workspaceId,
	projectId,
	workspaceName,
	branch,
	isMainWorkspace = false,
}: UseDashboardSidebarWorkspaceItemActionsOptions) {
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const hostService = useLocalHostService();
	const { activeHostUrl, activeOrganizationId } = hostService;
	const collections = useCollections();
	const { copyToClipboard } = useCopyToClipboard();
	const { v2Workspaces: workspaceActions } = useOptimisticCollectionActions();
	const { requestSectionRename } = useDashboardSidebarSectionRename();
	const setManualUnread = useV2NotificationStore((s) => s.setManualUnread);
	const clearManualUnread = useV2NotificationStore((s) => s.clearManualUnread);
	const markWorkspaceTerminalsSeen = useMarkWorkspaceTerminalsSeen(workspaceId);
	const isUnread = useV2WorkspaceIsUnread(workspaceId);
	const workspaceHostUrl = useWorkspaceHostUrl(workspaceId);
	const activeTheme = useTheme();

	const clearWorkspaceAttention = () => {
		clearManualUnread(workspaceId);
		markWorkspaceTerminalsSeen();
	};
	const { createSection, moveWorkspaceToSection, removeWorkspaceFromSidebar } =
		useDashboardSidebarState();

	const [isRenaming, setIsRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(workspaceName);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

	const isActive = !!matchRoute({
		to: "/v2-workspace/$workspaceId",
		params: { workspaceId },
		fuzzy: true,
	});

	const handleClick = () => {
		if (isRenaming) return;
		clearWorkspaceAttention();
		// In canvas display mode the route change keeps showing the same global
		// canvas — also glide the camera to the clicked workspace's windows.
		// Read at click time so sidebar rows don't each subscribe to prefs.
		const displayMode =
			collections.v2UserPreferences.get(V2_USER_PREFERENCES_ID)?.displayMode ??
			"tabs";
		if (displayMode === "canvas") {
			const canvasStore = getGlobalCanvasStore(
				activeOrganizationId ?? "default",
			);
			if (workspaceHasCanvasTerminal(canvasStore, workspaceId)) {
				fitCanvasCameraToWorkspace(canvasStore, workspaceId);
			} else if (workspaceHostUrl) {
				// No terminal on the canvas for this workspace — open a fresh one
				// where the user is looking instead of panning to whatever other
				// windows (browser panes) the workspace happens to have.
				void openWorkspaceTerminalOnCanvas({
					store: canvasStore,
					workspaceId,
					hostUrl: workspaceHostUrl,
					themeType: resolveTerminalThemeType({
						activeThemeType: activeTheme?.type,
					}),
				});
			} else {
				showHostServiceUnavailableToast(hostService, {
					action: "open a terminal",
				});
			}
		}
		navigate({
			to: "/v2-workspace/$workspaceId",
			params: { workspaceId },
		});
	};

	const startRename = () => {
		setRenameValue(workspaceName);
		setIsRenaming(true);
	};

	const cancelRename = () => {
		setIsRenaming(false);
		setRenameValue(workspaceName);
	};

	const submitRename = () => {
		setIsRenaming(false);
		const trimmed = renameValue.trim();
		if (!trimmed || trimmed === workspaceName) return;
		workspaceActions.renameWorkspace(workspaceId, trimmed);
	};

	const handleDeleted = () => {
		removeWorkspaceFromSidebar(workspaceId);
	};

	const handleRemoveFromSidebar = () => {
		useRemoveFromSidebarIntent.getState().request({
			workspaceId,
			workspaceName,
			projectId,
			isMain: isMainWorkspace,
		});
	};

	const handleCreateSection = () => {
		const sectionId = createSection(projectId);
		moveWorkspaceToSection(workspaceId, projectId, sectionId);
		requestSectionRename(sectionId);
	};

	const resolveWorktreePath = async (): Promise<string | null> => {
		if (!activeHostUrl) {
			showHostServiceUnavailableToast(hostService, {
				action: "resolve the workspace path",
			});
			return null;
		}
		const workspace = await getHostServiceClientByUrl(
			activeHostUrl,
		).workspace.get.query({ id: workspaceId });
		if (!workspace?.worktreePath) {
			toast.error("Workspace path is not available");
			return null;
		}
		return workspace.worktreePath;
	};

	const handleOpenInFinder = async () => {
		try {
			const path = await resolveWorktreePath();
			if (!path) return;
			await electronTrpcClient.external.openInFinder.mutate(path);
		} catch (error) {
			toast.error(
				`Failed to open in Finder: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	};

	const handleCopyPath = async () => {
		try {
			const path = await resolveWorktreePath();
			if (!path) return;
			await copyToClipboard(path);
			toast.success("Path copied");
		} catch (error) {
			toast.error(
				`Failed to copy path: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	};

	const handleToggleUnread = () => {
		if (isUnread) {
			clearWorkspaceAttention();
		} else {
			setManualUnread(workspaceId);
		}
	};

	// Working/permission dots are live host state now and can't be wiped;
	// "clear status" clears everything attention-shaped (manual + reviews).
	const handleClearStatus = () => {
		clearWorkspaceAttention();
	};

	const handleCopyBranchName = async () => {
		if (!branch) {
			toast.error("Branch name is not available");
			return;
		}
		try {
			await copyToClipboard(branch);
			toast.success("Branch name copied");
		} catch (error) {
			toast.error(
				`Failed to copy branch name: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	};

	return {
		cancelRename,
		handleClearStatus,
		handleClick,
		handleCopyPath,
		handleCopyBranchName,
		handleCreateSection,
		handleDeleted,
		handleOpenInFinder,
		handleRemoveFromSidebar,
		handleToggleUnread,
		isActive,
		isDeleteDialogOpen,
		isRenaming,
		isUnread,
		moveWorkspaceToSection,
		renameValue,
		setIsDeleteDialogOpen,
		setRenameValue,
		startRename,
		submitRename,
	};
}
