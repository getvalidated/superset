import { describe, expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import {
	collectDiffSearchMatches,
	type DiffSearchEntry,
} from "./collectDiffSearchMatches";

function makeEntry(
	original: string,
	modified: string,
	itemId = "diff:file.ts",
): DiffSearchEntry {
	return {
		itemId,
		changeKey: itemId.replace(/^diff:/, ""),
		fileDiff: parseDiffFromFile(
			{ name: "file.ts", contents: original },
			{ name: "file.ts", contents: modified },
		),
	};
}

const defaultOptions = {
	caseSensitive: false,
	expandUnchanged: false,
};

describe("collectDiffSearchMatches", () => {
	test("returns no matches for an empty query", () => {
		const entry = makeEntry("alpha\n", "alpha\nbeta\n");
		expect(
			collectDiffSearchMatches([entry], { ...defaultOptions, query: "" }),
		).toEqual([]);
	});

	test("finds matches on added lines with addition-side numbering", () => {
		const entry = makeEntry("alpha\n", "alpha\nneedle beta\n");
		const matches = collectDiffSearchMatches([entry], {
			...defaultOptions,
			query: "needle",
		});
		expect(matches).toEqual([
			{
				itemId: entry.itemId,
				changeKey: entry.changeKey,
				side: "additions",
				lineNumber: 2,
				occurrence: 0,
			},
		]);
	});

	test("finds matches on deleted lines with deletion-side numbering", () => {
		const entry = makeEntry("alpha\nneedle gone\nomega\n", "alpha\nomega\n");
		const matches = collectDiffSearchMatches([entry], {
			...defaultOptions,
			query: "needle",
		});
		expect(matches).toEqual([
			{
				itemId: entry.itemId,
				changeKey: entry.changeKey,
				side: "deletions",
				lineNumber: 2,
				occurrence: 0,
			},
		]);
	});

	test("finds matches on unchanged context lines inside hunks", () => {
		const entry = makeEntry("context needle\nold\n", "context needle\nnew\n");
		const matches = collectDiffSearchMatches([entry], {
			...defaultOptions,
			query: "needle",
		});
		expect(matches).toContainEqual({
			itemId: entry.itemId,
			changeKey: entry.changeKey,
			side: "additions",
			lineNumber: 1,
			occurrence: 0,
		});
	});

	test("counts multiple occurrences on one line separately", () => {
		const entry = makeEntry("", "foo foo foo\n");
		const matches = collectDiffSearchMatches([entry], {
			...defaultOptions,
			query: "foo",
		});
		expect(matches.map((match) => match.occurrence)).toEqual([0, 1, 2]);
		expect(new Set(matches.map((match) => match.lineNumber)).size).toBe(1);
	});

	test("respects case sensitivity", () => {
		const entry = makeEntry("", "Needle\nneedle\n");
		const insensitive = collectDiffSearchMatches([entry], {
			...defaultOptions,
			query: "needle",
		});
		expect(insensitive).toHaveLength(2);

		const sensitive = collectDiffSearchMatches([entry], {
			caseSensitive: true,
			expandUnchanged: false,
			query: "needle",
		});
		expect(sensitive).toHaveLength(1);
		expect(sensitive[0]?.lineNumber).toBe(2);
	});

	test("skips unchanged lines outside hunks unless expandUnchanged is set", () => {
		const farApartOriginal = `needle top\n${"pad\n".repeat(20)}old\n`;
		const farApartModified = `needle top\n${"pad\n".repeat(20)}new\n`;

		const entry = makeEntry(farApartOriginal, farApartModified);
		const collapsed = collectDiffSearchMatches([entry], {
			...defaultOptions,
			query: "needle",
		});
		expect(collapsed).toEqual([]);

		const expanded = collectDiffSearchMatches([entry], {
			caseSensitive: false,
			expandUnchanged: true,
			query: "needle",
		});
		expect(expanded).toEqual([
			{
				itemId: entry.itemId,
				changeKey: entry.changeKey,
				side: "additions",
				lineNumber: 1,
				occurrence: 0,
			},
		]);
	});

	test("orders matches by file, then rendered position", () => {
		const first = makeEntry("", "needle a\n", "diff:a.ts");
		const second = makeEntry("needle removed\n", "needle added\n", "diff:b.ts");
		const matches = collectDiffSearchMatches([first, second], {
			...defaultOptions,
			query: "needle",
		});
		expect(
			matches.map((match) => [match.itemId, match.side, match.lineNumber]),
		).toEqual([
			["diff:a.ts", "additions", 1],
			["diff:b.ts", "deletions", 1],
			["diff:b.ts", "additions", 1],
		]);
	});
});
