import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
	background,
	environment,
	presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { Alert, Pressable, View } from "react-native";
import { usePromptInputAttachments } from "@/components/ai-elements/prompt-input";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/hooks/useTheme";

// Pickers present their own view controller; wait for the sheet's
// dismissal animation or iOS drops the second presentation.
const SHEET_DISMISS_DELAY_MS = 400;

export function ContextSheet({
	isPresented,
	onIsPresentedChange,
	width,
}: {
	isPresented: boolean;
	onIsPresentedChange: (value: boolean) => void;
	width: number;
}) {
	const theme = useTheme();
	const attachments = usePromptInputAttachments();

	const runAfterDismiss = (action: () => void) => {
		onIsPresentedChange(false);
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

	return (
		<Host style={{ position: "absolute", width }}>
			<BottomSheet
				isPresented={isPresented}
				onIsPresentedChange={onIsPresentedChange}
				fitToContents
			>
				<Group
					modifiers={[
						environment("colorScheme", "dark"),
						presentationDragIndicator("visible"),
						background(theme.background),
					]}
				>
					<RNHostView matchContents>
						<View className="px-5 pb-6 pt-6">
							<Text
								className="mb-2 text-sm font-semibold"
								style={{ color: theme.mutedForeground }}
							>
								Add context
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
										color={theme.mutedForeground}
									/>
									<Text
										className="text-sm font-medium"
										style={{ color: theme.foreground }}
									>
										{row.label}
									</Text>
								</Pressable>
							))}
						</View>
					</RNHostView>
				</Group>
			</BottomSheet>
		</Host>
	);
}
