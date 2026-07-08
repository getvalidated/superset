import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/hooks/useTheme";

export function FilterRowValue({
	value,
	accessory,
}: {
	value: string;
	accessory?: ReactNode;
}) {
	const theme = useTheme();
	return (
		<>
			{accessory}
			<Text
				className="flex-shrink text-base"
				style={{ color: theme.mutedForeground }}
				numberOfLines={1}
			>
				{value}
			</Text>
			<Ionicons
				name="chevron-forward"
				size={18}
				color={theme.mutedForeground}
			/>
		</>
	);
}
