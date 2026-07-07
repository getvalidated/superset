import { describe, expect, it } from "bun:test";
import { resolveMarkdownLink } from "./resolveMarkdownLink";

const CURRENT = "documentation/engineering/build-mode/README.md";

describe("resolveMarkdownLink — relative file links", () => {
	it("resolves a sibling `./file.md` against the current directory", () => {
		expect(resolveMarkdownLink(CURRENT, "./01-control-flow.md")).toEqual({
			kind: "file",
			path: "documentation/engineering/build-mode/01-control-flow.md",
		});
	});

	it("resolves a parent `../dir/file.md`", () => {
		expect(resolveMarkdownLink(CURRENT, "../fiori/README.md")).toEqual({
			kind: "file",
			path: "documentation/engineering/fiori/README.md",
		});
	});

	it("resolves a bare relative path without `./`", () => {
		expect(resolveMarkdownLink(CURRENT, "01-control-flow.md")).toEqual({
			kind: "file",
			path: "documentation/engineering/build-mode/01-control-flow.md",
		});
	});

	it("resolves multiple `../` segments", () => {
		expect(resolveMarkdownLink(CURRENT, "../../overview.md")).toEqual({
			kind: "file",
			path: "documentation/overview.md",
		});
	});

	it("resolves a root-relative `/dir/file.md` against the workspace root", () => {
		expect(resolveMarkdownLink(CURRENT, "/README.md")).toEqual({
			kind: "file",
			path: "README.md",
		});
	});

	it("decodes percent-encoded path segments", () => {
		expect(resolveMarkdownLink(CURRENT, "./my%20notes.md")).toEqual({
			kind: "file",
			path: "documentation/engineering/build-mode/my notes.md",
		});
	});
});

describe("resolveMarkdownLink — anchors", () => {
	it("classifies a pure `#section` as an in-page anchor", () => {
		expect(resolveMarkdownLink(CURRENT, "#getting-started")).toEqual({
			kind: "anchor",
			anchor: "getting-started",
		});
	});

	it("keeps the anchor when following a relative file link", () => {
		expect(
			resolveMarkdownLink(CURRENT, "./01-control-flow.md#branches"),
		).toEqual({
			kind: "file",
			path: "documentation/engineering/build-mode/01-control-flow.md",
			anchor: "branches",
		});
	});
});

describe("resolveMarkdownLink — external links", () => {
	it("treats http(s) URLs as external", () => {
		expect(resolveMarkdownLink(CURRENT, "https://example.com/docs")).toEqual({
			kind: "external",
			href: "https://example.com/docs",
		});
	});

	it("treats mailto: as external", () => {
		expect(resolveMarkdownLink(CURRENT, "mailto:hi@example.com")).toEqual({
			kind: "external",
			href: "mailto:hi@example.com",
		});
	});

	it("treats protocol-relative URLs as external", () => {
		expect(resolveMarkdownLink(CURRENT, "//cdn.example.com/x")).toEqual({
			kind: "external",
			href: "//cdn.example.com/x",
		});
	});
});
