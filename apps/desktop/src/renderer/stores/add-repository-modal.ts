import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface NewProjectResult {
	projectId: string;
}

type ActiveModal = { kind: "none" } | { kind: "new-project" };

interface AddRepositoryModalState {
	active: ActiveModal;
	openNewProject: () => Promise<NewProjectResult | null>;
	resolveNewProject: (result: NewProjectResult | null) => void;
	close: () => void;
}

// Module-level resolver so callbacks aren't stored in zustand state. The store
// drives the modal's open/close UI; the resolver bridges the imperative open()
// call back to its caller.
let pendingResolve: ((result: NewProjectResult | null) => void) | null = null;

export const useAddRepositoryModalStore = create<AddRepositoryModalState>()(
	devtools(
		(set) => ({
			active: { kind: "none" },
			openNewProject: () => {
				pendingResolve?.(null);
				return new Promise<NewProjectResult | null>((resolve) => {
					pendingResolve = resolve;
					set({ active: { kind: "new-project" } });
				});
			},
			resolveNewProject: (result) => {
				const resolve = pendingResolve;
				pendingResolve = null;
				set({ active: { kind: "none" } });
				resolve?.(result);
			},
			close: () => {
				const resolve = pendingResolve;
				pendingResolve = null;
				set({ active: { kind: "none" } });
				resolve?.(null);
			},
		}),
		{ name: "add-repository-modal" },
	),
);

export const useAddRepositoryModalActive = () =>
	useAddRepositoryModalStore((state) => state.active);
export const useOpenNewProjectModal = () =>
	useAddRepositoryModalStore((state) => state.openNewProject);
export const useResolveNewProjectModal = () =>
	useAddRepositoryModalStore((state) => state.resolveNewProject);
export const useCloseAddRepositoryModal = () =>
	useAddRepositoryModalStore((state) => state.close);
