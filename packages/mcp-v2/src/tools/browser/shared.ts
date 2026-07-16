import { z } from "zod";

export interface BrowserWindowInfo {
	paneId: string;
	title: string;
	url: string;
	isLoading: boolean;
}

export const hostIdInput = z
	.string()
	.min(1)
	.describe(
		"Host machineId running the desktop app whose browser windows to control. See `hosts_list` to enumerate accessible hosts.",
	);

export const windowInput = z
	.string()
	.min(1)
	.describe(
		"Browser window identifier: a paneId from `browser_windows_list`, or a case-insensitive title/URL fragment that matches exactly one open window.",
	);
