import Ionicons from "@expo/vector-icons/Ionicons";
import {
	BottomSheetBackdrop,
	type BottomSheetBackdropProps,
	BottomSheetModal,
	BottomSheetView,
} from "@gorhom/bottom-sheet";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePromptInputAttachments } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { PhotoCarousel } from "./components/PhotoCarousel";

// Pickers present their own view controller; wait for the sheet's
// dismissal animation or iOS drops the second presentation.
const SHEET_DISMISS_DELAY_MS = 400;

export function ContextSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const insets = useSafeAreaInsets();
	const attachments = usePromptInputAttachments();
	const modalRef = useRef<BottomSheetModal>(null);
	const [selected, setSelected] = useState<MediaLibrary.Asset[]>([]);
	const [adding, setAdding] = useState(false);

	useEffect(() => {
		if (open) {
			modalRef.current?.present();
		} else {
			modalRef.current?.dismiss();
		}
	}, [open]);

	const handleDismiss = useCallback(() => {
		setSelected([]);
		onOpenChange(false);
	}, [onOpenChange]);

	const toggleAsset = useCallback((asset: MediaLibrary.Asset) => {
		setSelected((previous) =>
			previous.some((entry) => entry.id === asset.id)
				? previous.filter((entry) => entry.id !== asset.id)
				: [...previous, asset],
		);
	}, []);

	const runAfterDismiss = (action: () => void) => {
		onOpenChange(false);
		setTimeout(action, SHEET_DISMISS_DELAY_MS);
	};

	const openCamera = async () => {
		const permission = await ImagePicker.requestCameraPermissionsAsync();
		if (!permission.granted) {
			Alert.alert("Camera access is not allowed");
			return;
		}
		const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
		if (result.canceled) return;
		attachments.add(
			result.assets.map((asset) => ({
				mediaType: asset.mimeType,
				name: asset.fileName ?? undefined,
				size: asset.fileSize,
				type: "image" as const,
				uri: asset.uri,
			})),
		);
	};

	const handleAddSelected = async () => {
		setAdding(true);
		try {
			const items = await Promise.all(
				selected.map(async (asset) => {
					const info = await MediaLibrary.getAssetInfoAsync(asset);
					// Library assets are often HEIC, which the agent API
					// rejects — transcode to JPEG.
					const converted = await manipulateAsync(
						info.localUri ?? asset.uri,
						[],
						{ compress: 0.8, format: SaveFormat.JPEG },
					);
					return {
						mediaType: "image/jpeg",
						name: asset.filename,
						type: "image" as const,
						uri: converted.uri,
					};
				}),
			);
			attachments.add(items);
			setSelected([]);
			onOpenChange(false);
		} catch (error) {
			Alert.alert(
				"Could not add photos",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setAdding(false);
		}
	};

	const rows = [
		{
			icon: "images-outline" as const,
			label: "Photos",
			action: () => void attachments.openImagePicker(),
		},
		{
			icon: "camera-outline" as const,
			label: "Camera",
			action: () => void openCamera(),
		},
		{
			icon: "document-outline" as const,
			label: "Files",
			action: () => void attachments.openFilePicker(),
		},
	];

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
			accessibilityLabel="Add context"
			backdropComponent={renderBackdrop}
			backgroundStyle={{
				backgroundColor: THEME.dark.popover,
				borderColor: THEME.dark.border,
				borderWidth: 1,
			}}
			handleIndicatorStyle={{ backgroundColor: THEME.dark.mutedForeground }}
			onDismiss={handleDismiss}
			ref={modalRef}
		>
			<BottomSheetView style={{ paddingBottom: insets.bottom + 12 }}>
				<View className="relative items-center justify-center pb-4 pt-1">
					<Pressable
						accessibilityLabel="Close"
						className="absolute left-4 size-9 items-center justify-center rounded-full bg-secondary"
						onPress={() => onOpenChange(false)}
					>
						<Ionicons name="close" size={20} color={THEME.dark.foreground} />
					</Pressable>
					<Text className="font-semibold text-foreground text-lg">Context</Text>
				</View>
				<PhotoCarousel
					active={open}
					selected={selected}
					onToggle={toggleAsset}
				/>
				<View className="px-5 pt-4">
					<Text className="mb-1 text-muted-foreground text-sm font-semibold">
						Add
					</Text>
					{rows.map((row) => (
						<Pressable
							key={row.label}
							onPress={() => runAfterDismiss(row.action)}
							className="flex-row items-center gap-2.5 py-2.5"
						>
							<Ionicons
								name={row.icon}
								size={24}
								color={THEME.dark.mutedForeground}
							/>
							<Text className="text-foreground text-sm font-medium">
								{row.label}
							</Text>
						</Pressable>
					))}
				</View>
				{selected.length > 0 ? (
					<View className="px-5 pt-2">
						<Button
							className="rounded-full"
							disabled={adding}
							onPress={() => void handleAddSelected()}
							size="lg"
						>
							{adding ? (
								<Spinner size="small" />
							) : (
								<Text>{`Add ${selected.length}`}</Text>
							)}
						</Button>
					</View>
				) : null}
			</BottomSheetView>
		</BottomSheetModal>
	);
}
