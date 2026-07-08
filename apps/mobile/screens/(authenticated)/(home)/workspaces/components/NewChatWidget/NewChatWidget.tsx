import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { SUPERSET_CHAT_MODELS } from "@superset/shared/agent-models";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon } from "lucide-react-native";
import { useState } from "react";
import {
	Alert,
	KeyboardAvoidingView,
	Pressable,
	StyleSheet,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorName,
	ModelSelectorTrigger,
	ModelSelectorValue,
} from "@/components/ai-elements/model-selector";
import {
	PromptInput,
	PromptInputAttachments,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputHeader,
	type PromptInputMessage,
	PromptInputProvider,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import type { HostWorkspaceItem } from "@/hooks/useHostWorkspaces";
import { getHostServiceClientByUrl } from "@/lib/host-service/client";
import { ProjectAvatar } from "@/screens/(authenticated)/(home)/filter/components/ProjectAvatar";
import { BranchPickerSheet } from "./components/BranchPickerSheet";
import { ContextSheet } from "./components/ContextSheet";
import { TargetPickerSheet } from "./components/TargetPickerSheet";
import { useCreateChatWorkspace } from "./hooks/useCreateChatWorkspace";
import { useNewChatTargets } from "./hooks/useNewChatTargets";
import { useNewChatPreferencesStore } from "./stores/newChatPreferencesStore";

export function NewChatWidget({
	workspaces,
}: {
	workspaces: HostWorkspaceItem[];
}) {
	return (
		<View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
			<PromptInputProvider>
				<BottomSheetModalProvider>
					<NewChatWidgetInner workspaces={workspaces} />
				</BottomSheetModalProvider>
			</PromptInputProvider>
		</View>
	);
}

function NewChatWidgetInner({
	workspaces,
}: {
	workspaces: HostWorkspaceItem[];
}) {
	const insets = useSafeAreaInsets();
	const controller = usePromptInputController();

	const [targetSheetOpen, setTargetSheetOpen] = useState(false);
	const [branchSheetOpen, setBranchSheetOpen] = useState(false);
	const [contextSheetOpen, setContextSheetOpen] = useState(false);
	const [focused, setFocused] = useState(false);
	const [explicitTargetKey, setExplicitTargetKey] = useState<string | null>(
		null,
	);
	const [baseBranch, setBaseBranch] = useState<string | null>(null);

	const modelId = useNewChatPreferencesStore((state) => state.modelId);
	const setModelId = useNewChatPreferencesStore((state) => state.setModelId);
	const setTargetKey = useNewChatPreferencesStore(
		(state) => state.setTargetKey,
	);

	const { targets, defaultTarget } = useNewChatTargets(workspaces);
	const selectedTarget =
		targets.find((target) => target.key === explicitTargetKey) ?? defaultTarget;

	const { data: branchData } = useQuery({
		queryKey: [
			"host-service",
			"branches",
			selectedTarget?.hostUrl ?? null,
			selectedTarget?.projectId ?? null,
			"",
		],
		enabled: selectedTarget !== null,
		networkMode: "always" as const,
		queryFn: async () => {
			if (!selectedTarget) return null;
			return getHostServiceClientByUrl(
				selectedTarget.hostUrl,
			).workspaceCreation.searchBranches.query({
				projectId: selectedTarget.projectId,
				limit: 50,
				refresh: true,
			});
		},
	});

	const createChatWorkspace = useCreateChatWorkspace();
	const selectedModel = SUPERSET_CHAT_MODELS.find(
		(model) => model.id === modelId,
	);
	const branchLabel = baseBranch ?? branchData?.defaultBranch ?? "default";
	const expanded =
		focused ||
		controller.textInput.value.trim().length > 0 ||
		controller.attachments.attachments.length > 0;

	const handleSubmit = (message: PromptInputMessage) => {
		if (!selectedTarget) {
			Alert.alert("No project on an online host");
			return Promise.reject(new Error("No target"));
		}
		return createChatWorkspace
			.mutateAsync({
				target: selectedTarget,
				baseBranch,
				modelId,
				message,
			})
			.then(() => setBaseBranch(null));
	};

	return (
		<>
			<KeyboardAvoidingView
				behavior="padding"
				pointerEvents="box-none"
				style={{ flex: 1, justifyContent: "flex-end" }}
			>
				<View
					className="px-3"
					style={{ paddingBottom: focused ? 8 : insets.bottom + 8 }}
				>
					<PromptInput className="bg-card/95" onSubmit={handleSubmit}>
						{expanded ? (
							<PromptInputHeader className="gap-3">
								<Pressable
									className="flex-row items-center gap-1.5"
									disabled={targets.length === 0}
									onPress={() => setTargetSheetOpen(true)}
								>
									<ProjectAvatar
										name={selectedTarget?.projectName}
										iconUrl={selectedTarget?.projectIconUrl}
										size={18}
									/>
									<Text className="text-foreground text-sm font-medium">
										{selectedTarget?.projectName ?? "No project"}
									</Text>
								</Pressable>
								<Pressable
									className="flex-row items-center gap-1"
									disabled={!selectedTarget}
									onPress={() => setBranchSheetOpen(true)}
								>
									<Text
										className="text-muted-foreground text-sm"
										numberOfLines={1}
									>
										{branchLabel}
									</Text>
									<Icon
										as={ChevronDownIcon}
										className="size-3.5 text-muted-foreground"
									/>
								</Pressable>
							</PromptInputHeader>
						) : null}
						<PromptInputAttachments />
						<PromptInputBody>
							<PromptInputTextarea
								placeholder="Plan, ask, build..."
								onBlur={() => setFocused(false)}
								onFocus={() => setFocused(true)}
							/>
						</PromptInputBody>
						{expanded ? (
							<PromptInputFooter>
								<PromptInputTools>
									<PromptInputButton
										accessibilityLabel="Add context"
										onPress={() => setContextSheetOpen(true)}
									>
										<Icon as={PlusIcon} className="size-4" />
									</PromptInputButton>
									<ModelSelector value={modelId} onValueChange={setModelId}>
										<ModelSelectorTrigger size="sm" variant="ghost">
											<ModelSelectorValue>
												{selectedModel?.label}
											</ModelSelectorValue>
										</ModelSelectorTrigger>
										<ModelSelectorContent title="Model">
											<ModelSelectorList>
												{SUPERSET_CHAT_MODELS.map((model) => (
													<ModelSelectorItem key={model.id} value={model.id}>
														<ModelSelectorName>{model.label}</ModelSelectorName>
														<Text className="text-muted-foreground text-xs">
															{model.provider}
														</Text>
													</ModelSelectorItem>
												))}
											</ModelSelectorList>
										</ModelSelectorContent>
									</ModelSelector>
								</PromptInputTools>
								<PromptInputSubmit
									status={createChatWorkspace.isPending ? "submitted" : "ready"}
								/>
							</PromptInputFooter>
						) : null}
					</PromptInput>
				</View>
			</KeyboardAvoidingView>
			<TargetPickerSheet
				open={targetSheetOpen}
				onOpenChange={setTargetSheetOpen}
				targets={targets}
				selectedKey={selectedTarget?.key ?? null}
				onSelect={(target) => {
					setExplicitTargetKey(target.key);
					setTargetKey(target.key);
					setBaseBranch(null);
				}}
			/>
			<BranchPickerSheet
				open={branchSheetOpen}
				onOpenChange={setBranchSheetOpen}
				hostUrl={selectedTarget?.hostUrl ?? null}
				projectId={selectedTarget?.projectId ?? null}
				selectedBranch={baseBranch}
				onSelect={setBaseBranch}
			/>
			<ContextSheet
				open={contextSheetOpen}
				onOpenChange={setContextSheetOpen}
			/>
		</>
	);
}
