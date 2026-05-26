import { Text, View } from "react-native";
import type { Meta, StoryObj } from "@storybook/react-native";

const Welcome = () => (
	<View className="flex-1 items-center justify-center bg-background p-6">
		<Text className="text-2xl font-bold text-foreground">
			Storybook is working
		</Text>
		<Text className="mt-2 text-muted-foreground">
			Add stories to components/ or .rnstorybook/stories/
		</Text>
	</View>
);

const meta: Meta<typeof Welcome> = {
	title: "Welcome",
	component: Welcome,
};

export default meta;
type Story = StoryObj<typeof Welcome>;

export const Default: Story = {};
