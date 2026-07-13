import { LuTrendingDown, LuTrendingUp } from "react-icons/lu";

export interface TrendCellProps {
	trendPct: number | null;
}

/** 30d event volume vs the prior 30d, as a signed percentage. */
export function TrendCell({ trendPct }: TrendCellProps) {
	if (trendPct == null) return null;
	const positive = trendPct >= 0;
	return (
		<span
			className={
				positive
					? "flex items-center gap-1 text-emerald-500"
					: "flex items-center gap-1 text-red-400"
			}
		>
			{positive ? (
				<LuTrendingUp className="size-3.5" />
			) : (
				<LuTrendingDown className="size-3.5" />
			)}
			{positive ? "+" : ""}
			{trendPct}%
		</span>
	);
}
