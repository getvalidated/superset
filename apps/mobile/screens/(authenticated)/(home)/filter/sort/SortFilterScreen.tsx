import { useRouter } from "expo-router";
import { View } from "react-native";
import {
	SORT_OPTIONS,
	useWorkspacesFilterStore,
} from "@/screens/(authenticated)/(home)/workspaces/stores/workspacesFilterStore";
import { FilterCheck } from "../components/FilterCheck";
import { FilterRow } from "../components/FilterRow";

export function SortFilterScreen() {
	const router = useRouter();
	const sort = useWorkspacesFilterStore((store) => store.sort);
	const setSort = useWorkspacesFilterStore((store) => store.setSort);

	return (
		<View className="bg-background flex-1 px-6">
			{SORT_OPTIONS.map((option, index) => (
				<FilterRow
					key={option.value}
					label={option.label}
					trailing={<FilterCheck visible={option.value === sort} />}
					onPress={() => {
						setSort(option.value);
						router.back();
					}}
					isLast={index === SORT_OPTIONS.length - 1}
				/>
			))}
		</View>
	);
}
