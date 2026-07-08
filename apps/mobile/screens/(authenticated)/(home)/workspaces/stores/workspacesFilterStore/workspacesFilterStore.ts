import { create } from "zustand";

export type WorkspaceSort = "updatedAt" | "createdAt";

export const SORT_OPTIONS: { value: WorkspaceSort; label: string }[] = [
	{ label: "Last updated", value: "updatedAt" },
	{ label: "Date created", value: "createdAt" },
];

interface WorkspacesFilterStore {
	projectFilter: string | null;
	hostFilter: string | null;
	sort: WorkspaceSort;
	setProjectFilter: (projectId: string | null) => void;
	setHostFilter: (machineId: string | null) => void;
	setSort: (sort: WorkspaceSort) => void;
}

export const useWorkspacesFilterStore = create<WorkspacesFilterStore>(
	(set) => ({
		projectFilter: null,
		hostFilter: null,
		sort: "updatedAt",
		setProjectFilter: (projectId) => set({ projectFilter: projectId }),
		setHostFilter: (machineId) => set({ hostFilter: machineId }),
		setSort: (sort) => set({ sort }),
	}),
);
