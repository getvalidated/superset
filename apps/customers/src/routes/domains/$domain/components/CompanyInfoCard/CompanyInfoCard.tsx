import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superset/ui/card";
import { Skeleton } from "@superset/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { LuGlobe, LuSparkles } from "react-icons/lu";

import { useTRPC } from "@/trpc/react";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4 text-sm">
			<span className="text-muted-foreground shrink-0">{label}</span>
			<span className="text-right">{value ?? "—"}</span>
		</div>
	);
}

export interface CompanyInfoCardProps {
	domain: string;
}

/** Firmographics researched by Claude + web search, cached 30 days. */
export function CompanyInfoCard({ domain }: CompanyInfoCardProps) {
	const trpc = useTRPC();
	const [requested, setRequested] = useState(false);
	const enrichment = useQuery(
		trpc.customers.domainEnrichment.queryOptions(
			{ domain },
			{ staleTime: Number.POSITIVE_INFINITY, retry: false, enabled: requested },
		),
	);

	const data = enrichment.data;
	const isEmpty =
		data &&
		!data.companyName &&
		!data.description &&
		!data.employeeRange &&
		!data.stage;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<LuGlobe className="text-muted-foreground size-4" />
					{data?.companyName ?? "Company"}
				</CardTitle>
				<CardDescription>
					{!requested
						? "Firmographics researched with AI, on demand"
						: enrichment.isLoading
							? "Researching on the web — first run takes ~30s"
							: `AI-researched · ${data?.confidence ?? "low"} confidence${
									data
										? ` · ${formatDistanceToNow(new Date(data.fetchedAt), { addSuffix: true })}`
										: ""
								}`}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-2">
				{!requested ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setRequested(true)}
					>
						<LuSparkles />
						Research company
					</Button>
				) : enrichment.isLoading ? (
					<>
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-4 w-1/2" />
					</>
				) : enrichment.error ? (
					<p className="text-muted-foreground text-sm">
						Research failed — {enrichment.error.message}
					</p>
				) : isEmpty ? (
					<p className="text-muted-foreground text-sm">
						Couldn't identify a company behind this domain.
					</p>
				) : (
					<>
						{data?.description && (
							<p className="pb-1 text-sm">{data.description}</p>
						)}
						<Row label="Employees" value={data?.employeeRange} />
						<Row
							label="Stage"
							value={
								data?.stage ? (
									<Badge variant="outline">{data.stage}</Badge>
								) : null
							}
						/>
						<Row label="Industry" value={data?.industry} />
						<Row label="HQ" value={data?.headquarters} />
						{data && data.sources.length > 0 && (
							<p className="text-muted-foreground pt-1 text-xs">
								Sources:{" "}
								{data.sources.slice(0, 3).map((source, index) => (
									<a
										key={source}
										href={source}
										target="_blank"
										rel="noreferrer"
										className="hover:text-foreground underline"
									>
										[{index + 1}]{" "}
									</a>
								))}
							</p>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
