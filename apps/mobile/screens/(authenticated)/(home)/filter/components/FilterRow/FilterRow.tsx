import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/hooks/useTheme";

export function FilterRow({
	icon,
	label,
	trailing,
	onPress,
	isLast,
}: {
	icon?: ReactNode;
	label: string;
	trailing?: ReactNode;
	onPress: () => void;
	isLast?: boolean;
}) {
	const theme = useTheme();
	return (
		<Pressable
			onPress={onPress}
			className="flex-row items-center gap-3 py-4"
			style={
				isLast
					? undefined
					: {
							borderBottomColor: theme.border,
							borderBottomWidth: StyleSheet.hairlineWidth,
						}
			}
		>
			{icon ? <View className="w-7 items-center">{icon}</View> : null}
			<Text className="text-base" style={{ color: theme.foreground }}>
				{label}
			</Text>
			<View className="flex-1 flex-row items-center justify-end gap-2">
				{trailing}
			</View>
		</Pressable>
	);
}
