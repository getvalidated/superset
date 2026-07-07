import { describe, expect, it } from "bun:test";
import { slugifyHeading } from "./slugifyHeading";

describe("slugifyHeading", () => {
	it("lowercases and hyphenates whitespace", () => {
		expect(slugifyHeading("Getting Started")).toBe("getting-started");
	});

	it("strips punctuation", () => {
		expect(slugifyHeading("What's new?")).toBe("whats-new");
	});

	it("collapses multiple spaces into a single hyphen", () => {
		expect(slugifyHeading("Build   Mode")).toBe("build-mode");
	});

	it("preserves existing hyphens", () => {
		expect(slugifyHeading("Control-Flow Basics")).toBe("control-flow-basics");
	});

	it("trims surrounding whitespace", () => {
		expect(slugifyHeading("  Overview  ")).toBe("overview");
	});
});
