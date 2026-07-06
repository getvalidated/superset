import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mirrors the slugify() used by <Command> in
// apps/docs/src/components/Command/Command.tsx to derive section anchors.
function slugify(name: string): string {
	return name
		.replace(/<[^>]+>/g, "")
		.replace(/\.\.\./g, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
}

const reference = readFileSync(
	fileURLToPath(new URL("./cli-reference.mdx", import.meta.url)),
	"utf8",
);

// Anchors the page actually exposes: one <section id> per <Command name="…">.
const commandAnchors = new Set(
	[...reference.matchAll(/<Command\b[^>]*\bname="([^"]+)"/g)].map((m) =>
		slugify(m[1]),
	),
);

describe("cli-reference deep-link section (#5475)", () => {
	test("every internal #superset-agents-* link resolves to a real section", () => {
		const brokenLinks = [
			...reference.matchAll(/\]\(#(superset-agents-[a-z0-9-]+)\)/g),
		]
			.map((m) => m[1])
			.filter((anchor) => !commandAnchors.has(anchor));

		expect(brokenLinks).toEqual([]);
	});

	test("no snippet or prose invokes the removed `superset agents run` command", () => {
		expect(reference).not.toContain("agents run");
	});
});
