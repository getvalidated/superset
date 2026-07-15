import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	listSubagentTranscripts,
	readSubagentTranscript,
	transcriptLineToItems,
} from "./transcripts";

const SESSION_ID = "d358fa53-9d6f-41ec-bc2e-dc0bccf20d23";

function makeProjectsRoot(): { rootDir: string; subagentsDir: string } {
	const rootDir = mkdtempSync(path.join(os.tmpdir(), "subagents-test-"));
	const subagentsDir = path.join(
		rootDir,
		"-Users-someone-project",
		SESSION_ID,
		"subagents",
	);
	mkdirSync(subagentsDir, { recursive: true });
	return { rootDir, subagentsDir };
}

function transcriptLine(record: unknown): string {
	return `${JSON.stringify(record)}\n`;
}

const promptLine = transcriptLine({
	type: "user",
	message: { role: "user", content: "Map the import flow end to end" },
	timestamp: "2026-07-15T17:57:57.858Z",
	sessionId: SESSION_ID,
});

const assistantLine = transcriptLine({
	type: "assistant",
	message: {
		role: "assistant",
		content: [
			{ type: "text", text: "Looking at the flow now." },
			{ type: "tool_use", name: "Bash", input: { command: "ls src" } },
		],
	},
});

describe("listSubagentTranscripts", () => {
	test("finds transcripts by session id and extracts the prompt title", () => {
		const { rootDir, subagentsDir } = makeProjectsRoot();
		writeFileSync(path.join(subagentsDir, "agent-abc123.jsonl"), promptLine);

		const result = listSubagentTranscripts(SESSION_ID, rootDir);
		expect(result).toHaveLength(1);
		expect(result[0]?.subagentId).toBe("abc123");
		expect(result[0]?.title).toBe("Map the import flow end to end");
		expect(result[0]?.startedAtMs).toBe(
			new Date("2026-07-15T17:57:57.858Z").getTime(),
		);
	});

	test("returns empty for unknown sessions and malformed ids", () => {
		const { rootDir } = makeProjectsRoot();
		expect(listSubagentTranscripts("nope", rootDir)).toEqual([]);
		expect(listSubagentTranscripts("../escape", rootDir)).toEqual([]);
	});

	test("ignores files that do not match the transcript pattern", () => {
		const { rootDir, subagentsDir } = makeProjectsRoot();
		writeFileSync(path.join(subagentsDir, "notes.txt"), "hi");
		writeFileSync(path.join(subagentsDir, "agent-bad$id.jsonl"), promptLine);
		expect(listSubagentTranscripts(SESSION_ID, rootDir)).toEqual([]);
	});
});

describe("transcriptLineToItems", () => {
	test("maps assistant text and tool_use blocks", () => {
		expect(transcriptLineToItems(assistantLine.trim())).toEqual([
			{ kind: "text", text: "Looking at the flow now." },
			{ kind: "tool_use", name: "Bash", detail: "ls src" },
		]);
	});

	test("keeps string user content and drops tool_result arrays", () => {
		expect(transcriptLineToItems(promptLine.trim())).toEqual([
			{ kind: "user", text: "Map the import flow end to end" },
		]);
		const toolResult = transcriptLine({
			type: "user",
			message: {
				role: "user",
				content: [{ type: "tool_result", content: "output" }],
			},
		});
		expect(transcriptLineToItems(toolResult.trim())).toEqual([]);
	});

	test("returns nothing for unparseable lines", () => {
		expect(transcriptLineToItems("{truncated")).toEqual([]);
	});
});

describe("readSubagentTranscript", () => {
	test("tails incrementally and skips the incomplete trailing line", () => {
		const { rootDir, subagentsDir } = makeProjectsRoot();
		const filePath = path.join(subagentsDir, "agent-tail1.jsonl");
		writeFileSync(filePath, promptLine);

		const first = readSubagentTranscript({
			agentSessionId: SESSION_ID,
			subagentId: "tail1",
			offsetBytes: 0,
			rootDir,
		});
		expect(first?.items).toEqual([
			{ kind: "user", text: "Map the import flow end to end" },
		]);
		expect(first?.nextOffsetBytes).toBe(Buffer.byteLength(promptLine));

		// Append one full line plus a partial line still being written.
		appendFileSync(filePath, `${assistantLine}{"type":"assis`);
		const second = readSubagentTranscript({
			agentSessionId: SESSION_ID,
			subagentId: "tail1",
			offsetBytes: first?.nextOffsetBytes ?? 0,
			rootDir,
		});
		expect(second?.items).toEqual([
			{ kind: "text", text: "Looking at the flow now." },
			{ kind: "tool_use", name: "Bash", detail: "ls src" },
		]);
		expect(second?.nextOffsetBytes).toBe(
			Buffer.byteLength(promptLine) + Buffer.byteLength(assistantLine),
		);

		// Nothing new — offset stays put.
		const third = readSubagentTranscript({
			agentSessionId: SESSION_ID,
			subagentId: "tail1",
			offsetBytes: second?.nextOffsetBytes ?? 0,
			rootDir,
		});
		expect(third?.items).toEqual([]);
		expect(third?.nextOffsetBytes).toBe(second?.nextOffsetBytes);
	});

	test("returns null for a missing transcript or traversal ids", () => {
		const { rootDir } = makeProjectsRoot();
		expect(
			readSubagentTranscript({
				agentSessionId: SESSION_ID,
				subagentId: "missing",
				offsetBytes: 0,
				rootDir,
			}),
		).toBeNull();
		expect(
			readSubagentTranscript({
				agentSessionId: SESSION_ID,
				subagentId: "../../etc/passwd",
				offsetBytes: 0,
				rootDir,
			}),
		).toBeNull();
	});
});
