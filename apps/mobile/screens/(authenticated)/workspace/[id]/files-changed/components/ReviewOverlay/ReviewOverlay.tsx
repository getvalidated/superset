import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { ListOrdered } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { PressableScale } from "@/screens/(authenticated)/components/PressableScale";

const GLASS = isLiquidGlassAvailable();

function GlassPill({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	if (!GLASS) {
		return (
			<View
				className={cn(
					"bg-card border-border overflow-hidden rounded-full border",
					className,
				)}
			>
				{children}
			</View>
		);
	}
	return (
		<GlassView
			// Dark-pinned to avoid the glass-material theme-toggle bug; the app is
			// dark-only.
			colorScheme="dark"
			glassEffectStyle="regular"
			isInteractive
			style={{ borderRadius: 999, overflow: "hidden" }}
		>
			{children}
		</GlassView>
	);
}

export function ReviewOverlay({
	draftCount,
	onFinishReview,
	onJumpToFile,
}: {
	draftCount: number;
	onFinishReview: () => void;
	onJumpToFile: () => void;
}) {
	const insets = useSafeAreaInsets();
	return (
		<View
			className="absolute right-0 left-0 items-center"
			pointerEvents="box-none"
			style={{ bottom: Math.max(insets.bottom, 12) + 4 }}
		>
			{draftCount > 0 ? (
				<Animated.View
					entering={FadeIn.duration(150)}
					exiting={FadeOut.duration(120)}
				>
					<GlassPill>
						<PressableScale
							className="flex-row items-center gap-2 px-4 py-2.5"
							onPress={onFinishReview}
						>
							<Text className="font-semibold text-[13.5px]">Finish review</Text>
							<View className="bg-foreground rounded-full px-1.5 py-0.5">
								<Text className="text-background text-[10.5px] font-bold">
									{draftCount}
								</Text>
							</View>
						</PressableScale>
					</GlassPill>
				</Animated.View>
			) : null}
			<View className="absolute right-3" style={{ bottom: 0 }}>
				<GlassPill>
					<PressableScale
						accessibilityLabel="Jump to file"
						className="size-10 items-center justify-center"
						onPress={onJumpToFile}
					>
						<Icon as={ListOrdered} className="text-foreground size-4.5" />
					</PressableScale>
				</GlassPill>
			</View>
		</View>
	);
}
