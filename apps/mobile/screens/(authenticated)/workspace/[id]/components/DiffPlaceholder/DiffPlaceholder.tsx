import { FileDiff } from "lucide-react-native";
import { View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

export function DiffPlaceholder() {
	return (
		<View className="flex-1 items-center justify-center gap-2 px-10 pb-16">
			<Icon
				as={FileDiff}
				className="text-muted-foreground/50 size-10"
				strokeWidth={1.4}
			/>
			<Text className="mt-2 font-semibold text-[17px]">Diff view</Text>
			<Text className="text-muted-foreground text-center text-sm">
				File changes for this branch will appear here.
			</Text>
		</View>
	);
}
