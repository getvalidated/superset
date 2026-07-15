import { ChatServiceProvider } from "@superset/chat/client";
import { cn } from "@superset/ui/utils";
import { type ReactNode, useState } from "react";
import { createChatServiceIpcClient } from "renderer/components/Chat/utils/chat-service-client";
import { useIsV2CloudEnabled } from "renderer/hooks/useIsV2CloudEnabled";
import { electronQueryClient } from "renderer/providers/ElectronTRPCProvider";
import { AppearanceSettings } from "renderer/routes/_authenticated/settings/appearance/components/AppearanceSettings";
import { BehaviorSettings } from "renderer/routes/_authenticated/settings/behavior/components/BehaviorSettings";
import { ExperimentalSettings } from "renderer/routes/_authenticated/settings/experimental/components/ExperimentalSettings";
import { GitSettings } from "renderer/routes/_authenticated/settings/git/components/GitSettings";
import { V2GitSettings } from "renderer/routes/_authenticated/settings/git/components/V2GitSettings";
import { LinksSettings } from "renderer/routes/_authenticated/settings/links/components/LinksSettings";
import { ModelsSettings } from "renderer/routes/_authenticated/settings/models/components/ModelsSettings";
import { RingtonesSettings } from "renderer/routes/_authenticated/settings/ringtones/components/RingtonesSettings";
import { TerminalSettings } from "renderer/routes/_authenticated/settings/terminal/components/TerminalSettings";
import type { CanvasSettingsData } from "../openCanvasWindow";

function CanvasGitSettings() {
	const isV2CloudEnabled = useIsV2CloudEnabled();
	if (isV2CloudEnabled) return <V2GitSettings hostId={null} />;
	return <GitSettings />;
}

// The settings route holds preset-editing state in search params; here it's
// window-local — a canvas settings window doesn't own the URL.
function CanvasTerminalSettings() {
	const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
	const [pendingCreateProjectId, setPendingCreateProjectId] = useState<
		string | null
	>(null);
	return (
		<TerminalSettings
			editingPresetId={editingPresetId}
			onEditingPresetIdChange={setEditingPresetId}
			pendingCreateProjectId={pendingCreateProjectId}
			onPendingCreateProjectIdChange={setPendingCreateProjectId}
		/>
	);
}

const chatServiceIpcClient = createChatServiceIpcClient();

function CanvasModelsSettings() {
	return (
		<ChatServiceProvider
			client={chatServiceIpcClient}
			queryClient={electronQueryClient}
		>
			<ModelsSettings />
		</ChatServiceProvider>
	);
}

interface CanvasSettingsSection {
	id: string;
	label: string;
	render: () => ReactNode;
}

// Sections whose components mount cleanly outside the settings route. Keyboard
// is excluded — its UI lives inline in the route page, not a reusable
// component. Route-scoped sections (account, organization, hosts, projects, …)
// stay in the full settings screen.
const SECTIONS: CanvasSettingsSection[] = [
	{
		id: "appearance",
		label: "Appearance",
		render: () => <AppearanceSettings />,
	},
	{ id: "ringtones", label: "Ringtones", render: () => <RingtonesSettings /> },
	{ id: "behavior", label: "Behavior", render: () => <BehaviorSettings /> },
	{ id: "git", label: "Git", render: () => <CanvasGitSettings /> },
	{
		id: "terminal",
		label: "Terminal",
		render: () => <CanvasTerminalSettings />,
	},
	{ id: "links", label: "Links", render: () => <LinksSettings /> },
	{ id: "models", label: "Models", render: () => <CanvasModelsSettings /> },
	{
		id: "experimental",
		label: "Experimental",
		render: () => <ExperimentalSettings />,
	},
];

/**
 * Embedded settings for a canvas window: a compact section nav beside the
 * same section components the settings route renders. The active section is
 * part of the window's persisted data so it survives canvas reloads.
 */
export function CanvasSettingsPane({
	data,
	onDataChange,
}: {
	data: CanvasSettingsData;
	onDataChange: (data: CanvasSettingsData) => void;
}) {
	const activeSection =
		SECTIONS.find((section) => section.id === data.section) ?? SECTIONS[0];

	return (
		<div className="flex h-full min-h-0 w-full">
			<nav className="w-36 min-w-28 shrink-0 overflow-y-auto border-r border-border/60 p-1.5">
				{SECTIONS.map((section) => (
					<button
						key={section.id}
						type="button"
						onClick={() => onDataChange({ section: section.id })}
						className={cn(
							"w-full rounded px-2 py-1.5 text-left text-xs transition-colors",
							section.id === activeSection.id
								? "bg-muted font-medium text-foreground"
								: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
						)}
					>
						{section.label}
					</button>
				))}
			</nav>
			<div className="min-w-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl">{activeSection.render()}</div>
			</div>
		</div>
	);
}
