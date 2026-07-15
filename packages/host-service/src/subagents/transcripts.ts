import {
	closeSync,
	existsSync,
	openSync,
	readdirSync,
	readSync,
	statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

// Claude Code writes each subagent's transcript to
//   ~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<id>.jsonl
// the moment the parent session spawns it. We locate the session dir by
// scanning project dirs for the session id rather than re-deriving Claude's
// cwd encoding, which is undocumented and cwd-dependent.

const TRANSCRIPT_FILE_PATTERN = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;
const TITLE_SCAN_BYTES = 64 * 1024;
const MAX_SLICE_BYTES = 2 * 1024 * 1024;
const TOOL_DETAIL_MAX_CHARS = 200;
const TITLE_MAX_CHARS = 140;

export interface SubagentTranscriptSummary {
	subagentId: string;
	/** First user message of the transcript — the task prompt. */
	title: string;
	sizeBytes: number;
	mtimeMs: number;
	startedAtMs: number;
}

export type SubagentTranscriptItem =
	| { kind: "user"; text: string }
	| { kind: "text"; text: string }
	| { kind: "tool_use"; name: string; detail: string };

export interface SubagentTranscriptSlice {
	items: SubagentTranscriptItem[];
	/** Byte offset after the last fully-written line — pass back to tail. */
	nextOffsetBytes: number;
	sizeBytes: number;
	mtimeMs: number;
}

export function claudeProjectsRoot(): string {
	return path.join(os.homedir(), ".claude", "projects");
}

// Session dirs never move once created, so positive lookups cache forever.
// Misses are NOT cached: the dir appears the first time a subagent spawns.
const sessionDirCache = new Map<string, string>();

function findSessionDir(sessionId: string, rootDir: string): string | null {
	const cached = sessionDirCache.get(sessionId);
	if (cached?.startsWith(rootDir) && existsSync(cached)) return cached;

	let projectDirs: string[];
	try {
		projectDirs = readdirSync(rootDir);
	} catch {
		return null;
	}
	for (const entry of projectDirs) {
		const candidate = path.join(rootDir, entry, sessionId);
		if (existsSync(candidate)) {
			sessionDirCache.set(sessionId, candidate);
			return candidate;
		}
	}
	return null;
}

// Prompts are immutable once written, so successful title reads cache by
// file path. Failures (first line still mid-write) stay uncached and retry.
const titleCache = new Map<string, { title: string; startedAtMs: number }>();

function readFirstLine(filePath: string): string | null {
	const fd = openSync(filePath, "r");
	try {
		const buffer = Buffer.alloc(TITLE_SCAN_BYTES);
		const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
		const newlineAt = buffer.indexOf(0x0a);
		if (newlineAt === -1 || newlineAt >= bytesRead) return null;
		return buffer.toString("utf8", 0, newlineAt);
	} finally {
		closeSync(fd);
	}
}

function collapseWhitespace(text: string, maxChars: number): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length > maxChars
		? `${collapsed.slice(0, maxChars - 1)}…`
		: collapsed;
}

function extractTitleAndStart(
	filePath: string,
): { title: string; startedAtMs: number } | null {
	const cached = titleCache.get(filePath);
	if (cached) return cached;
	const line = readFirstLine(filePath);
	if (!line) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	const record = parsed as {
		message?: { content?: unknown };
		timestamp?: unknown;
	};
	const content = record.message?.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.map((block) =>
							typeof (block as { text?: unknown }).text === "string"
								? ((block as { text: string }).text as string)
								: "",
						)
						.join(" ")
				: "";
	const startedAtMs =
		typeof record.timestamp === "string"
			? new Date(record.timestamp).getTime() || 0
			: 0;
	const result = {
		title: collapseWhitespace(text, TITLE_MAX_CHARS) || "Subagent",
		startedAtMs,
	};
	titleCache.set(filePath, result);
	return result;
}

function resolveTranscriptPath(
	agentSessionId: string,
	subagentId: string,
	rootDir: string,
): string | null {
	// Ids are path segments — reject anything that could traverse.
	if (!/^[A-Za-z0-9_-]+$/.test(agentSessionId)) return null;
	if (!/^[A-Za-z0-9_-]+$/.test(subagentId)) return null;
	const sessionDir = findSessionDir(agentSessionId, rootDir);
	if (!sessionDir) return null;
	return path.join(sessionDir, "subagents", `agent-${subagentId}.jsonl`);
}

/** All subagent transcripts spawned by one Claude session, newest last. */
export function listSubagentTranscripts(
	agentSessionId: string,
	rootDir: string = claudeProjectsRoot(),
): SubagentTranscriptSummary[] {
	if (!/^[A-Za-z0-9_-]+$/.test(agentSessionId)) return [];
	const sessionDir = findSessionDir(agentSessionId, rootDir);
	if (!sessionDir) return [];
	const subagentsDir = path.join(sessionDir, "subagents");
	let entries: string[];
	try {
		entries = readdirSync(subagentsDir);
	} catch {
		return [];
	}
	const summaries: SubagentTranscriptSummary[] = [];
	for (const entry of entries) {
		const subagentId = TRANSCRIPT_FILE_PATTERN.exec(entry)?.[1];
		if (!subagentId) continue;
		const filePath = path.join(subagentsDir, entry);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(filePath);
		} catch {
			continue;
		}
		const meta = extractTitleAndStart(filePath);
		summaries.push({
			subagentId,
			title: meta?.title ?? "Subagent",
			sizeBytes: stat.size,
			mtimeMs: stat.mtimeMs,
			startedAtMs: meta?.startedAtMs || stat.birthtimeMs || stat.mtimeMs,
		});
	}
	summaries.sort((a, b) => a.startedAtMs - b.startedAtMs);
	return summaries;
}

function summarizeToolInput(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const record = input as Record<string, unknown>;
	for (const key of [
		"command",
		"description",
		"file_path",
		"path",
		"pattern",
		"query",
		"url",
		"prompt",
	]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return collapseWhitespace(value, TOOL_DETAIL_MAX_CHARS);
		}
	}
	try {
		return collapseWhitespace(JSON.stringify(record), TOOL_DETAIL_MAX_CHARS);
	} catch {
		return "";
	}
}

export function transcriptLineToItems(line: string): SubagentTranscriptItem[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return [];
	}
	const record = parsed as {
		type?: unknown;
		message?: { content?: unknown };
	};
	const content = record.message?.content;
	// User entries with array content are tool_result echoes — the tool_use
	// item above them already tells the story, so they're dropped.
	if (record.type === "user" && typeof content === "string") {
		const text = content.trim();
		return text ? [{ kind: "user", text }] : [];
	}
	if (record.type !== "assistant" || !Array.isArray(content)) return [];
	const items: SubagentTranscriptItem[] = [];
	for (const block of content) {
		const typed = block as {
			type?: unknown;
			text?: unknown;
			name?: unknown;
			input?: unknown;
		};
		if (typed.type === "text" && typeof typed.text === "string") {
			const text = typed.text.trim();
			if (text) items.push({ kind: "text", text });
		} else if (typed.type === "tool_use" && typeof typed.name === "string") {
			items.push({
				kind: "tool_use",
				name: typed.name,
				detail: summarizeToolInput(typed.input),
			});
		}
	}
	return items;
}

/**
 * Read the transcript from `offsetBytes`, returning only fully-written
 * lines. The next call resumes at `nextOffsetBytes`, so a pane tails the
 * file incrementally without re-reading history.
 */
export function readSubagentTranscript({
	agentSessionId,
	subagentId,
	offsetBytes,
	rootDir = claudeProjectsRoot(),
}: {
	agentSessionId: string;
	subagentId: string;
	offsetBytes: number;
	rootDir?: string;
}): SubagentTranscriptSlice | null {
	const filePath = resolveTranscriptPath(agentSessionId, subagentId, rootDir);
	if (!filePath) return null;
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(filePath);
	} catch {
		return null;
	}
	// A shrunken file means the offset is from a different incarnation.
	const safeOffset = offsetBytes > stat.size ? 0 : offsetBytes;
	if (safeOffset >= stat.size) {
		return {
			items: [],
			nextOffsetBytes: safeOffset,
			sizeBytes: stat.size,
			mtimeMs: stat.mtimeMs,
		};
	}

	const toRead = Math.min(stat.size - safeOffset, MAX_SLICE_BYTES);
	const buffer = Buffer.alloc(toRead);
	const fd = openSync(filePath, "r");
	let bytesRead: number;
	try {
		bytesRead = readSync(fd, buffer, 0, toRead, safeOffset);
	} finally {
		closeSync(fd);
	}
	const lastNewline = buffer.lastIndexOf(0x0a, bytesRead - 1);
	if (lastNewline === -1) {
		// No complete line yet (mid-write) — try again next poll.
		return {
			items: [],
			nextOffsetBytes: safeOffset,
			sizeBytes: stat.size,
			mtimeMs: stat.mtimeMs,
		};
	}
	const complete = buffer.toString("utf8", 0, lastNewline);
	const items: SubagentTranscriptItem[] = [];
	for (const line of complete.split("\n")) {
		if (line.trim()) items.push(...transcriptLineToItems(line));
	}
	return {
		items,
		nextOffsetBytes: safeOffset + lastNewline + 1,
		sizeBytes: stat.size,
		mtimeMs: stat.mtimeMs,
	};
}
