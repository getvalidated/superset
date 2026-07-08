import {
	BottomSheetBackdrop,
	type BottomSheetBackdropProps,
	BottomSheetModal,
	BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { CheckIcon } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { ProjectAvatar } from "@/screens/(authenticated)/(home)/filter/components/ProjectAvatar";
import type { NewChatTarget } from "../../hooks/useNewChatTargets";

export function TargetPickerSheet({
	open,
	onOpenChange,
	targets,
	selectedKey,
	onSelect,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	targets: NewChatTarget[];
	selectedKey: string | null;
	onSelect: (target: NewChatTarget) => void;
}) {
	const modalRef = useRef<BottomSheetModal>(null);

	useEffect(() => {
		if (open) {
			modalRef.current?.present();
		} else {
			modalRef.current?.dismiss();
		}
	}, [open]);

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
			accessibilityLabel="Select a project"
			backdropComponent={renderBackdrop}
			backgroundStyle={{
				backgroundColor: THEME.dark.popover,
				borderColor: THEME.dark.border,
				borderWidth: 1,
			}}
			enableDynamicSizing={false}
			handleIndicatorStyle={{ backgroundColor: THEME.dark.mutedForeground }}
			onDismiss={() => onOpenChange(false)}
			ref={modalRef}
			snapPoints={["50%"]}
		>
			<BottomSheetScrollView
				contentContainerStyle={{ padding: 8 }}
				keyboardShouldPersistTaps="handled"
			>
				<Text className="px-3 pb-2 pt-1 text-muted-foreground text-xs font-medium uppercase">
					Projects
				</Text>
				{targets.length === 0 ? (
					<View className="items-center px-4 py-6">
						<Text className="text-center text-muted-foreground text-sm">
							No projects on an online host
						</Text>
					</View>
				) : null}
				{targets.map((target) => {
					const isSelected = target.key === selectedKey;
					return (
						<Pressable
							accessibilityRole="button"
							accessibilityState={{ selected: isSelected }}
							className="flex-row items-center gap-3 rounded-md px-3 py-3 active:bg-accent"
							key={target.key}
							onPress={() => {
								onSelect(target);
								onOpenChange(false);
							}}
						>
							<ProjectAvatar
								name={target.projectName}
								iconUrl={target.projectIconUrl}
								size={32}
							/>
							<View className="flex-1">
								<Text className="text-foreground text-sm font-medium">
									{target.projectName}
								</Text>
								<Text className="text-muted-foreground text-xs">
									{target.hostName}
								</Text>
							</View>
							{isSelected ? (
								<Icon as={CheckIcon} className="size-4 text-foreground" />
							) : null}
						</Pressable>
					);
				})}
			</BottomSheetScrollView>
		</BottomSheetModal>
	);
}
