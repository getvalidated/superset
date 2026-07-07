/**
 * Converts heading text into a GitHub-style anchor slug so in-page links like
 * `#getting-started` can be matched against rendered `<h1>`–`<h6>` elements.
 *
 * Mirrors GitHub's algorithm: lowercase, strip punctuation, collapse
 * whitespace to single hyphens.
 */
export function slugifyHeading(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-");
}
