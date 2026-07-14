import {
	getDomainEnrichment,
	getPersonEnrichment,
} from "./src/router/customers/enrichment";

for (const d of ["posthog.com", "loom.com", "anthropic.com"]) {
	const t = Date.now();
	const r = await getDomainEnrichment(d);
	console.log(
		`\n=== ${d} (${((Date.now() - t) / 1000).toFixed(0)}s, ${r.confidence}) ===`,
	);
	console.log(
		`raised=${r.totalRaised} | lastRound=${r.lastRoundAt} | founded=${r.foundedYear}`,
	);
	console.log(`yc=${r.ycBatch} | parent=${r.parentCompany} | stage=${r.stage}`);
	console.log(`investors=${r.investors.join(", ") || "-"}`);
}

const p = await getPersonEnrichment({
	cacheKey: "fields-test-avi",
	name: "Avi Peltz",
	domain: "superset.sh",
});
console.log(
	`\n=== person ===\ntitle=${p.title} | location=${p.location} | conf=${p.confidence}`,
);
process.exit(0);
