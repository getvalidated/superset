import type { HostAgentConfig } from "@superset/shared/host-agent-config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export function hostAgentConfigsQueryKey(hostUrl: string | null) {
	return ["host-agent-configs", hostUrl] as const;
}

export function useHostAgentConfigs() {
	const { activeHostUrl } = useLocalHostService();
	const queryClient = useQueryClient();

	const list = useQuery({
		queryKey: hostAgentConfigsQueryKey(activeHostUrl),
		enabled: !!activeHostUrl,
		queryFn: async (): Promise<HostAgentConfig[]> => {
			if (!activeHostUrl) return [];
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.settings.agentConfigs.list.query();
		},
	});

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: hostAgentConfigsQueryKey(activeHostUrl),
		});

	const add = useMutation({
		mutationFn: async (input: {
			presetId: string;
			label: string;
			launchCommand: string;
			promptInput: HostAgentConfig["promptInput"];
		}) => {
			if (!activeHostUrl) throw new Error("No active host");
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.settings.agentConfigs.add.mutate({
				id: crypto.randomUUID(),
				...input,
			});
		},
		onSuccess: invalidate,
	});

	const update = useMutation({
		mutationFn: async (input: {
			id: string;
			patch: {
				label?: string;
				launchCommand?: string;
				promptInput?: HostAgentConfig["promptInput"];
			};
		}) => {
			if (!activeHostUrl) throw new Error("No active host");
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.settings.agentConfigs.update.mutate(input);
		},
		onSuccess: invalidate,
	});

	const remove = useMutation({
		mutationFn: async (id: string) => {
			if (!activeHostUrl) throw new Error("No active host");
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.settings.agentConfigs.remove.mutate({ id });
		},
		onSuccess: invalidate,
	});

	const reorder = useMutation({
		mutationFn: async (ids: string[]) => {
			if (!activeHostUrl) throw new Error("No active host");
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.settings.agentConfigs.reorder.mutate({ ids });
		},
		onSuccess: invalidate,
	});

	return {
		configs: list.data ?? [],
		isLoading: list.isLoading,
		isFetched: list.isFetched,
		add,
		update,
		remove,
		reorder,
	};
}
