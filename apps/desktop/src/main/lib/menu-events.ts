import { EventEmitter } from "node:events";
export type SettingsSection =
	| "project"
	| "workspace"
	| "appearance"
	| "keyboard"
	| "behavior"
	| "git"
	| "terminal"
	| "integrations";

export interface OpenSettingsEvent {
	section?: SettingsSection;
}

export interface OpenWorkspaceEvent {
	workspaceId: string;
}

export type EditCommand = "undo" | "redo";

export const menuEmitter = new EventEmitter();
