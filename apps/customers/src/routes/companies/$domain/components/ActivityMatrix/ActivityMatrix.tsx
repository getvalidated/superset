import type { RouterOutputs } from "@superset/trpc";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superset/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Skeleton } from "@superset/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { useTRPC } from "@/trpc/react";

type MatrixData = RouterOutputs["customers"]["domainActivityMatrix"];
type MatrixUser = MatrixData["users"][number];
type MatrixCell = MatrixUser["cells"][number];

const CELL = 12;
const ROW_H = 22;
const HEADER_H = 18;
const DAYS = 90;
const USER_COUNT_OPTIONS = [10, 25, 50, 100, 200];

const CATEGORY_COLORS = {
	terminal: "#fbbf24",
	chat: "#a78bfa",
	workspace: "#38bdf8",
} as const;
const CREATED_COLOR = "#34d399";
const FIRST_DAY_COLOR = "#34d399";
const PR_COLOR = "#e879f9";

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	timeZone: "UTC",
});
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

function dateForDay(start: Date, d: number): Date {
	return new Date(start.getTime() + d * 24 * 60 * 60 * 1000);
}

function dominantCategory(cell: MatrixCell): keyof typeof CATEGORY_COLORS {
	if (cell.terminal >= cell.chat && cell.terminal >= cell.workspace) {
		return "terminal";
	}
	return cell.chat >= cell.workspace ? "chat" : "workspace";
}

function dotRadius(total: number): number {
	if (total >= 20) return 4.5;
	if (total >= 5) return 3.5;
	return 2.5;
}

function cellTooltip(cell: MatrixCell, day: string): string {
	const parts = [
		cell.terminal > 0 && `${cell.terminal} terminal`,
		cell.chat > 0 && `${cell.chat} chat`,
		cell.workspace > 0 && `${cell.workspace} workspace`,
		cell.created > 0 && `${cell.created} workspace created`,
	].filter(Boolean);
	return `${day} — ${parts.join(", ")}`;
}

function UserDots({
	user,
	start,
	row,
}: {
	user: MatrixUser;
	start: Date;
	row: number;
}) {
	const cy = HEADER_H + row * ROW_H + ROW_H / 2;
	return (
		<g>
			{user.firstDayIndex != null && (
				<circle
					cx={user.firstDayIndex * CELL + CELL / 2}
					cy={cy}
					r={4.5}
					fill="none"
					stroke={FIRST_DAY_COLOR}
					strokeWidth={1.5}
				>
					<title>{`${DAY_FORMAT.format(dateForDay(start, user.firstDayIndex))} — first day (signed up)`}</title>
				</circle>
			)}
			{user.cells.map((cell) => {
				const cx = cell.d * CELL + CELL / 2;
				const total = cell.terminal + cell.chat + cell.workspace;
				const day = DAY_FORMAT.format(dateForDay(start, cell.d));
				const categoryCount = [cell.terminal, cell.chat, cell.workspace].filter(
					(count) => count > 0,
				).length;
				if (cell.created > 0) {
					return (
						<rect
							key={cell.d}
							x={cx - 3.5}
							y={cy - 3.5}
							width={7}
							height={7}
							rx={1.5}
							fill={CREATED_COLOR}
						>
							<title>{cellTooltip(cell, day)}</title>
						</rect>
					);
				}
				return (
					<circle
						key={cell.d}
						cx={cx}
						cy={cy}
						r={dotRadius(total)}
						fill={CATEGORY_COLORS[dominantCategory(cell)]}
						stroke={categoryCount > 1 ? "#e2e8f0" : "none"}
						strokeWidth={categoryCount > 1 ? 1 : 0}
						strokeOpacity={0.6}
					>
						<title>{cellTooltip(cell, day)}</title>
					</circle>
				);
			})}
		</g>
	);
}

function LegendDot({ color, label }: { color: string; label: string }) {
	return (
		<span className="flex items-center gap-1.5">
			<span
				className="size-2.5 rounded-full"
				style={{ backgroundColor: color }}
			/>
			{label}
		</span>
	);
}

export interface ActivityMatrixProps {
	domain: string;
}

/**
 * GitHub-garden-style dot plot: one row per user, one column per day. Dot hue
 * = dominant activity category, size = volume; milestones get shapes (hollow
 * ring = first day, square = workspace created, diamond = PR merged).
 */
export function ActivityMatrix({ domain }: ActivityMatrixProps) {
	const trpc = useTRPC();
	const [userCount, setUserCount] = useState(10);

	const matrix = useQuery(
		trpc.customers.domainActivityMatrix.queryOptions(
			{ domain, days: DAYS, users: userCount },
			{ staleTime: 60_000, placeholderData: (previous) => previous },
		),
	);

	const data = matrix.data;
	const start = data ? new Date(data.start) : null;
	const hasPrRow = (data?.prCells.length ?? 0) > 0;
	const rows = (data?.users.length ?? 0) + (hasPrRow ? 1 : 0);
	const gridWidth = DAYS * CELL;
	const gridHeight = HEADER_H + rows * ROW_H;
	const prRowIndex = 0;
	const userRowOffset = hasPrRow ? 1 : 0;

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between space-y-0">
				<div className="space-y-1.5">
					<CardTitle>Activity matrix</CardTitle>
					<CardDescription>
						Who did what, day by day, over the last {DAYS} days
					</CardDescription>
				</div>
				<Select
					value={String(userCount)}
					onValueChange={(value) => setUserCount(Number(value))}
				>
					<SelectTrigger className="w-32">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{USER_COUNT_OPTIONS.map((option) => (
							<SelectItem key={option} value={String(option)}>
								{option} users
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</CardHeader>
			<CardContent>
				{matrix.isLoading && !data ? (
					<Skeleton className="h-48 w-full" />
				) : matrix.error ? (
					<p className="text-muted-foreground text-sm">
						Failed to load activity matrix — {matrix.error.message}
					</p>
				) : data && start ? (
					<div className="space-y-3">
						<div
							className={
								matrix.isFetching
									? "flex opacity-60 transition-opacity"
									: "flex"
							}
						>
							<div className="w-40 shrink-0">
								<div style={{ height: HEADER_H }} />
								{hasPrRow && (
									<div
										className="text-muted-foreground flex items-center text-xs font-medium"
										style={{ height: ROW_H }}
									>
										PRs merged
									</div>
								)}
								{data.users.map((user) => (
									<div
										key={user.userId}
										className="flex items-center pr-3"
										style={{ height: ROW_H }}
									>
										<Link
											to="/users/$userId"
											params={{ userId: user.userId }}
											className="truncate text-xs hover:underline"
											title={user.email}
										>
											{user.name}
										</Link>
									</div>
								))}
							</div>
							<div className="overflow-x-auto">
								<svg
									width={gridWidth}
									height={gridHeight}
									role="img"
									aria-label="Per-user daily activity dot plot"
								>
									{/* Weekend shading */}
									{Array.from({ length: DAYS }, (_, d) => d)
										.filter((d) => {
											const weekday = dateForDay(start, d).getUTCDay();
											return weekday === 0 || weekday === 6;
										})
										.map((d) => (
											<rect
												key={d}
												x={d * CELL}
												y={HEADER_H}
												width={CELL}
												height={rows * ROW_H}
												fill="currentColor"
												opacity={0.04}
											/>
										))}
									{/* Month labels */}
									{Array.from({ length: DAYS }, (_, d) => d)
										.filter(
											(d) => d === 0 || dateForDay(start, d).getUTCDate() === 1,
										)
										.map((d) => (
											<text
												key={d}
												x={d * CELL + 2}
												y={HEADER_H - 6}
												className="fill-muted-foreground"
												fontSize={10}
											>
												{MONTH_FORMAT.format(dateForDay(start, d))}
											</text>
										))}
									{/* Row separators */}
									{Array.from({ length: rows }, (_, row) => row).map((row) => (
										<line
											key={row}
											x1={0}
											x2={gridWidth}
											y1={HEADER_H + row * ROW_H}
											y2={HEADER_H + row * ROW_H}
											stroke="currentColor"
											strokeOpacity={0.06}
										/>
									))}
									{/* PR merge diamonds (company-level) */}
									{hasPrRow &&
										data.prCells.map((cell) => {
											const cx = cell.d * CELL + CELL / 2;
											const cy = HEADER_H + prRowIndex * ROW_H + ROW_H / 2;
											const size = cell.count > 2 ? 4.5 : 3.5;
											return (
												<rect
													key={cell.d}
													x={cx - size}
													y={cy - size}
													width={size * 2}
													height={size * 2}
													rx={1}
													transform={`rotate(45 ${cx} ${cy})`}
													fill={PR_COLOR}
												>
													<title>{`${DAY_FORMAT.format(dateForDay(start, cell.d))} — ${cell.count} PR${cell.count === 1 ? "" : "s"} merged (${cell.authors.join(", ")})`}</title>
												</rect>
											);
										})}
									{data.users.map((user, index) => (
										<UserDots
											key={user.userId}
											user={user}
											start={start}
											row={index + userRowOffset}
										/>
									))}
								</svg>
							</div>
						</div>
						<div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
							<LegendDot color={CATEGORY_COLORS.terminal} label="Terminal" />
							<LegendDot color={CATEGORY_COLORS.chat} label="Chat" />
							<LegendDot color={CATEGORY_COLORS.workspace} label="Workspace" />
							<span className="flex items-center gap-1.5">
								<span
									className="size-2.5 rounded-[3px]"
									style={{ backgroundColor: CREATED_COLOR }}
								/>
								Workspace created
							</span>
							<span className="flex items-center gap-1.5">
								<span
									className="size-2.5 rounded-full border-[1.5px]"
									style={{ borderColor: FIRST_DAY_COLOR }}
								/>
								First day
							</span>
							<span className="flex items-center gap-1.5">
								<span
									className="size-2.5 rotate-45 rounded-[2px]"
									style={{ backgroundColor: PR_COLOR }}
								/>
								PR merged
							</span>
							<span>Dot size = event volume</span>
							{data.totalUsers > userCount && (
								<span>
									Showing {data.users.length} of {data.totalUsers} users
								</span>
							)}
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
