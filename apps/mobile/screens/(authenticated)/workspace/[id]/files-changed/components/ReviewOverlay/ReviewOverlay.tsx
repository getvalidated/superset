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
	tintColor,
}: {
	children: ReactNode;
	className?: string;
	tintColor?: string;
}) {
	if (!GLASS) {
		return (
			<View
				className={cn(
					"bg-card border-border overflow-hidden rounded-full border",
					className,
				)}
				style={tintColor ? { backgroundColor: tintColor } : undefined}
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
			tintColor={tintColor}
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
	// Right-aligned thumb cluster: the CTA sits beside the jump button, not
	// centered across the screen.
	return (
		<View
			className="absolute right-0 left-0 flex-row items-center justify-end gap-2.5 pr-3"
			pointerEvents="box-none"
			style={{ bottom: Math.max(insets.bottom, 12) + 4 }}
		>
			{draftCount > 0 ? (
				<Animated.View
					entering={FadeIn.duration(150)}
					exiting={FadeOut.duration(120)}
				>
					<GlassPill tintColor="#16a34a">
						<PressableScale
							className="h-12 flex-row items-center gap-2 px-4"
							onPress={onFinishReview}
						>
							<Text className="font-semibold text-[14px] text-white">
								Finish review
							</Text>
							<View className="rounded-full bg-white/90 px-1.5 py-0.5">
								<Text className="font-bold text-[10.5px] text-green-700">
									{draftCount}
								</Text>
							</View>
						</PressableScale>
					</GlassPill>
				</Animated.View>
			) : null}
			<GlassPill>
				<PressableScale
					accessibilityLabel="Jump to file"
					className="size-12 items-center justify-center"
					onPress={onJumpToFile}
				>
					<Icon as={ListOrdered} className="text-foreground size-5" />
				</PressableScale>
			</GlassPill>
		</View>
	);
}
