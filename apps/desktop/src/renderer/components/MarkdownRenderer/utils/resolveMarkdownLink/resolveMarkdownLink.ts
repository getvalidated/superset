/**
 * Resolves an href found inside a rendered markdown document into an actionable
 * navigation target, relative to the file the markdown was loaded from.
 *
 * The markdown viewer historically rendered links but could not follow relative
 * ones (`./file.md`, `../dir/file.md`) or in-page anchors (`#section`). This
 * helper classifies an href so the renderer knows whether to open another file,
 * scroll to a heading, or hand the link off to the OS/browser.
 */

export type ResolvedMarkdownLink =
	| { kind: "external"; href: string }
	| { kind: "anchor"; anchor: string }
	| { kind: "file"; path: string; anchor?: string };

// A leading scheme such as `http:`, `https:`, `mailto:`, `tel:`, `vscode:`.
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

function dirnameSegments(filePath: string): string[] {
	const segments = filePath.split("/").filter(Boolean);
	// Drop the file name itself, leaving the containing directory.
	segments.pop();
	return segments;
}

function normalizeSegments(base: string[], relative: string): string[] {
	const stack = [...base];

	for (const segment of relative.split("/")) {
		if (segment === "" || segment === ".") {
			continue;
		}
		if (segment === "..") {
			stack.pop();
			continue;
		}
		stack.push(segment);
	}

	return stack;
}

function decode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function resolveMarkdownLink(
	currentFilePath: string,
	href: string,
): ResolvedMarkdownLink {
	const trimmed = href.trim();

	// Nothing to navigate to.
	if (trimmed === "") {
		return { kind: "external", href };
	}

	// Absolute URLs, protocol-relative URLs, and non-file schemes are external.
	if (trimmed.startsWith("//") || SCHEME_PATTERN.test(trimmed)) {
		return { kind: "external", href: trimmed };
	}

	// Pure in-page anchor.
	if (trimmed.startsWith("#")) {
		return { kind: "anchor", anchor: decode(trimmed.slice(1)) };
	}

	const hashIndex = trimmed.indexOf("#");
	const rawPath = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
	const anchor =
		hashIndex === -1 ? undefined : decode(trimmed.slice(hashIndex + 1));

	// Root-relative links resolve against the workspace root; everything else
	// resolves against the current file's directory.
	const isRootRelative = rawPath.startsWith("/");
	const base = isRootRelative ? [] : dirnameSegments(currentFilePath);
	const relative = isRootRelative ? rawPath.slice(1) : rawPath;

	const path = normalizeSegments(base, decode(relative)).join("/");

	return anchor === undefined
		? { kind: "file", path }
		: { kind: "file", path, anchor };
}
