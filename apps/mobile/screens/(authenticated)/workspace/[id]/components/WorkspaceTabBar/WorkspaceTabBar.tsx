import { FileDiff, MessageCircle } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export type WorkspaceTab = "chats" | "diff";

const TABS = [
	{ key: "chats", label: "Chats", icon: MessageCircle },
	{ key: "diff", label: "Diff", icon: FileDiff },
] as const;

export function WorkspaceTabBar({
	tab,
	onTabChange,
}: {
	tab: WorkspaceTab;
	onTabChange: (tab: WorkspaceTab) => void;
}) {
	const insets = useSafeAreaInsets();

	return (
		<View
			className="border-border/60 bg-background flex-row border-t"
			style={{ paddingBottom: insets.bottom }}
		>
			{TABS.map((item) => {
				const active = item.key === tab;
				return (
					<Pressable
						key={item.key}
						accessibilityRole="tab"
						accessibilityState={{ selected: active }}
						className="flex-1 items-center gap-1 pt-2.5 pb-1"
						onPress={() => onTabChange(item.key)}
					>
						<Icon
							as={item.icon}
							className={cn(
								"size-6",
								active ? "text-foreground" : "text-muted-foreground/70",
							)}
							strokeWidth={1.8}
						/>
						<Text
							className={cn(
								"font-semibold text-[10.5px]",
								active ? "text-foreground" : "text-muted-foreground/70",
							)}
						>
							{item.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
