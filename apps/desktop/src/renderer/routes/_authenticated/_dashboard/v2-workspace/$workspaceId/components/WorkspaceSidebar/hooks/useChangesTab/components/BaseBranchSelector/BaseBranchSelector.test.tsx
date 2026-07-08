import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BaseBranchSelector } from "./BaseBranchSelector";

const LONG_BRANCH_NAME =
	"feature/some-really-long-base-branch-name-that-should-truncate";

describe("BaseBranchSelector", () => {
	it("renders the current base branch name in the trigger", () => {
		const markup = renderToStaticMarkup(
			<BaseBranchSelector
				branches={[{ name: LONG_BRANCH_NAME, isCurrent: false } as never]}
				currentValue={LONG_BRANCH_NAME}
				onChange={() => {}}
			/>,
		);

		expect(markup).toContain(LONG_BRANCH_NAME);
	});

	// Reproduces #5506: the "from" base branch name wraps instead of
	// truncating. The active branch (rendered by ChangesHeader) truncates,
	// but this trigger button rendered the branch name as a bare text node
	// with no `truncate`/`min-w-0`, so a long name wrapped onto a second line.
	it("truncates a long base branch name in the trigger button", () => {
		const markup = renderToStaticMarkup(
			<BaseBranchSelector
				branches={[{ name: LONG_BRANCH_NAME, isCurrent: false } as never]}
				currentValue={LONG_BRANCH_NAME}
				onChange={() => {}}
			/>,
		);

		// The branch name must be wrapped in a truncating element so it stays
		// on a single line, and the trigger button must be allowed to shrink.
		expect(markup).toMatch(/class="[^"]*\btruncate\b[^"]*"[^>]*>[^<]*feature/);
		expect(markup).toMatch(/<button[^>]*class="[^"]*\bmin-w-0\b/);
	});
});
