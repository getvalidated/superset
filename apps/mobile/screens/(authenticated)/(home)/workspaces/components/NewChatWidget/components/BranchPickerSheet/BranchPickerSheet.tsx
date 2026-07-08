import {
	BottomSheetBackdrop,
	type BottomSheetBackdropProps,
	BottomSheetModal,
	BottomSheetScrollView,
	BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { getHostServiceClientByUrl } from "@/lib/host-service/client";
import { THEME } from "@/lib/theme";

function BranchRow({
	name,
	isSelected,
	isLast,
	onPress,
}: {
	name: string;
	isSelected: boolean;
	isLast?: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: isSelected }}
			className="flex-row items-center gap-2 py-4 active:opacity-70"
			onPress={onPress}
			style={
				isLast
					? undefined
					: {
							borderBottomColor: THEME.dark.border,
							borderBottomWidth: StyleSheet.hairlineWidth,
						}
			}
		>
			<Text className="flex-1 text-base text-foreground" numberOfLines={1}>
				{name}
			</Text>
			{isSelected ? (
				<Icon as={CheckIcon} className="size-5 text-foreground" />
			) : null}
		</Pressable>
	);
}

function SectionLabel({ children }: { children: string }) {
	return (
		<Text className="pb-1 pt-5 text-base text-muted-foreground">
			{children}
		</Text>
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
			backgroundStyle={{ backgroundColor: THEME.dark.background }}
			enableDynamicSizing={false}
			handleIndicatorStyle={{ backgroundColor: THEME.dark.mutedForeground }}
			onDismiss={handleDismiss}
			ref={modalRef}
			snapPoints={["92%"]}
		>
			<View className="flex-1 px-5">
				<View className="flex-row items-center py-2">
					<Pressable
						accessibilityLabel="Close"
						accessibilityRole="button"
						className="size-10 items-center justify-center rounded-full bg-muted active:opacity-70"
						onPress={() => onOpenChange(false)}
					>
						<Icon as={XIcon} className="size-5 text-foreground" />
					</Pressable>
					<Text className="flex-1 pr-10 text-center text-lg font-semibold text-foreground">
						Branch
					</Text>
				</View>
				<View className="mt-2 flex-row items-center gap-2.5 rounded-full bg-muted px-4">
					<Icon as={SearchIcon} className="size-5 text-muted-foreground" />
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
							fontSize: 17,
							paddingVertical: 12,
						}}
						value={query}
					/>
				</View>
				<BottomSheetScrollView
					contentContainerStyle={{ paddingBottom: 48 }}
					keyboardShouldPersistTaps="handled"
				>
					{defaultBranch ? (
						<>
							<SectionLabel>Default</SectionLabel>
							<BranchRow
								name={defaultBranch}
								isSelected={
									selectedBranch === null || selectedBranch === defaultBranch
								}
								onPress={() => selectAndClose(null)}
								isLast
							/>
						</>
					) : null}
					{branches.length > 0 ? (
						<SectionLabel>{trimmedQuery ? "Branches" : "Recents"}</SectionLabel>
					) : null}
					{branches.map((branch, index) => (
						<BranchRow
							key={branch.name}
							name={branch.name}
							isSelected={selectedBranch === branch.name}
							onPress={() => selectAndClose(branch.name)}
							isLast={index === branches.length - 1}
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
