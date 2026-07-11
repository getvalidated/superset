import { Stack } from "expo-router";

// `index` is the workspace landing page (chat list + diff tabs); chat threads
// live in the nested `chat` stack.
export default function WorkspaceLayout() {
	return <Stack screenOptions={{ headerShown: false }} />;
}
