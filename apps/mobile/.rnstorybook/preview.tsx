import { PortalHost } from "@rn-primitives/portal";
import type { Preview } from "@storybook/react-native";
import { NavigationContainer } from "expo-router/react-navigation";
import { View } from "react-native";
import { cn } from "@/lib/utils";

const preview: Preview = {
	decorators: [
		(Story, context) => {
			const isFullscreen = context.parameters?.layout === "fullscreen";
			return (
				<NavigationContainer>
					<View className={cn("flex-1 bg-background", !isFullscreen && "p-4")}>
						<Story />
						<PortalHost />
					</View>
				</NavigationContainer>
			);
		},
	],
	parameters: {
		controls: {
			matchers: {
				color: /(background|color|foreground)$/i,
				date: /Date$/i,
			},
		},
		moduleMock: {
			mockingPairedModules: {
				tty: () => require("./mocks/tty"),
			},
		},
	},
};

export default preview;
