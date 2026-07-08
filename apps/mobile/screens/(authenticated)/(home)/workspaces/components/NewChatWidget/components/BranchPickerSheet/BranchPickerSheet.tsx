import {
	BottomSheetBackdrop,
	type BottomSheetBackdropProps,
	BottomSheetModal,
	BottomSheetScrollView,
	BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, SearchIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { getHostServiceClientByUrl } from "@/lib/host-service/client";
import { THEME } from "@/lib/theme";

function BranchRow({
	name,
	isSelected,
	onPress,
}: {
	name: string;
	isSelected: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: isSelected }}
			className="flex-row items-center gap-2 rounded-md px-3 py-3 active:bg-accent"
			onPress={onPress}
		>
			<Text className="flex-1 text-foreground text-sm" numberOfLines={1}>
				{name}
			</Text>
			{isSelected ? (
				<Icon as={CheckIcon} className="size-4 text-foreground" />
			) : null}
		</Pressable>
	);
}

export function BranchPickerSheet({
	open,
	onOpenChange,
	hostUrl,
	projectId,
	selectedBranch,
	onSelect,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	hostUrl: string | null;
	projectId: string | null;
	/** Null = default branch. */
	selectedBranch: string | null;
	onSelect: (branch: string | null) => void;
}) {
	const modalRef = useRef<BottomSheetModal>(null);
	const [query, setQuery] = useState("");

	useEffect(() => {
		if (open) {
			modalRef.current?.present();
		} else {
			modalRef.current?.dismiss();
		}
	}, [open]);

	const trimmedQuery = query.trim();
	const { data, isLoading } = useQuery({
		queryKey: ["host-service", "branches", hostUrl, projectId, trimmedQuery],
		enabled: open && hostUrl !== null && projectId !== null,
		placeholderData: (previous) => previous,
		networkMode: "always" as const,
		queryFn: async () => {
			if (!hostUrl || !projectId) return null;
			return getHostServiceClientByUrl(
				hostUrl,
			).workspaceCreation.searchBranches.query({
				projectId,
				query: trimmedQuery || undefined,
				limit: 50,
				refresh: trimmedQuery === "",
			});
		},
	});

	const defaultBranch = data?.defaultBranch ?? null;
	const branches = useMemo(
		() => (data?.items ?? []).filter((branch) => branch.name !== defaultBranch),
		[data, defaultBranch],
	);

	const handleDismiss = useCallback(() => {
		setQuery("");
		onOpenChange(false);
	}, [onOpenChange]);

	const selectAndClose = useCallback(
		(branch: string | null) => {
			onSelect(branch);
			onOpenChange(false);
		},
		[onSelect, onOpenChange],
	);

	const renderBackdrop = useCallback(
		(backdropProps: BottomSheetBackdropProps) => (
			<BottomSheetBackdrop
				{...backdropProps}
				appearsOnIndex={0}
				disappearsOnIndex={-1}
				pressBehavior="close"
			/>
		),
		[],
	);

	return (
		<BottomSheetModal
			accessibilityLabel="Select a base branch"
			backdropComponent={renderBackdrop}
			backgroundStyle={{
				backgroundColor: THEME.dark.popover,
				borderColor: THEME.dark.border,
				borderWidth: 1,
			}}
			enableDynamicSizing={false}
			handleIndicatorStyle={{ backgroundColor: THEME.dark.mutedForeground }}
			onDismiss={handleDismiss}
			ref={modalRef}
			snapPoints={["65%"]}
		>
			<View className="flex-1">
				<View className="flex-row items-center gap-2 border-border border-b px-4 pb-3">
					<Icon as={SearchIcon} className="size-4 text-muted-foreground" />
					<BottomSheetTextInput
						accessibilityLabel="Search branches"
						autoCapitalize="none"
						autoCorrect={false}
						onChangeText={setQuery}
						placeholder="Branches..."
						placeholderTextColor={THEME.dark.mutedForeground}
						style={{
							color: THEME.dark.foreground,
							flex: 1,
							fontSize: 16,
							paddingVertical: 8,
						}}
						value={query}
					/>
				</View>
				<BottomSheetScrollView
					contentContainerStyle={{ padding: 8 }}
					keyboardShouldPersistTaps="handled"
				>
					{defaultBranch ? (
						<>
							<Text className="px-3 pb-2 pt-1 text-muted-foreground text-xs font-medium uppercase">
								Default
							</Text>
							<BranchRow
								name={defaultBranch}
								isSelected={
									selectedBranch === null || selectedBranch === defaultBranch
								}
								onPress={() => selectAndClose(null)}
							/>
						</>
					) : null}
					{branches.length > 0 ? (
						<Text className="px-3 pb-2 pt-3 text-muted-foreground text-xs font-medium uppercase">
							{trimmedQuery ? "Branches" : "Recents"}
						</Text>
					) : null}
					{branches.map((branch) => (
						<BranchRow
							key={branch.name}
							name={branch.name}
							isSelected={selectedBranch === branch.name}
							onPress={() => selectAndClose(branch.name)}
						/>
					))}
					{isLoading && !data ? (
						<View className="items-center py-6">
							<Spinner size="small" />
						</View>
					) : null}
					{!isLoading && !defaultBranch && branches.length === 0 ? (
						<View className="items-center px-4 py-6">
							<Text className="text-center text-muted-foreground text-sm">
								No branches found
							</Text>
						</View>
					) : null}
				</BottomSheetScrollView>
			</View>
		</BottomSheetModal>
	);
}
