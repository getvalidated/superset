import { Stack } from "expo-router";

// Native bottom toolbar: bar button items get the same system glass treatment
// as the header buttons, sized and positioned by UIKit. Badges aren't
// supported in bottom placements, so the draft count rides in the label.
export function ReviewOverlay({
	draftCount,
	onFinishReview,
	onJumpToFile,
}: {
	draftCount: number;
	onFinishReview: () => void;
	onJumpToFile: () => void;
}) {
	return (
		<Stack.Toolbar placement="bottom">
			<Stack.Toolbar.Spacer />
			<Stack.Toolbar.Button
				hidden={draftCount === 0}
				variant="prominent"
				tintColor="#16a34a"
				onPress={onFinishReview}
			>
				{`Finish review (${draftCount})`}
			</Stack.Toolbar.Button>
			<Stack.Toolbar.Button
				icon="list.number"
				accessibilityLabel="Jump to file"
				onPress={onJumpToFile}
			/>
		</Stack.Toolbar>
	);
}
