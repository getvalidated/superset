import { View } from "react-native";
import { Text } from "@/components/ui/text";

export function ChangesScreen() {
	return (
		<View className="bg-background flex-1 items-center justify-center p-6">
			<Text className="text-center text-muted-foreground">
				File changes for this workspace will appear here
			</Text>
		</View>
	);
}
