import Anthropic from "@anthropic-ai/sdk";
import type { LinearClient } from "@linear/sdk";
import type { Attachment } from "discord.js";
import { env } from "./env";

const anthropic = env.ANTHROPIC_API_KEY
	? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
	: undefined;

const ENHANCE_MODEL = "claude-sonnet-5";

const VISION_TYPES = new Set<Anthropic.Base64ImageSource["media_type"]>([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
]);
// Claude image blocks cap at ~5MB; Linear uploads at 50MB.
const MAX_VISION_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// Cap per-file text fed to the model (logs/code); the full file is still linked.
const MAX_TEXT_CHARS = 20_000;

type Artifact = {
	name: string;
	contentType: string;
	url: string;
	isImage: boolean;
	visionData?: string;
	textContent?: string;
};

function isVisionType(
	contentType: string,
): contentType is Anthropic.Base64ImageSource["media_type"] {
	return VISION_TYPES.has(
		contentType as Anthropic.Base64ImageSource["media_type"],
	);
}

// Code/log/config attachments — including the message.txt Discord auto-attaches
// for long posts — whose content should be read into the summarization.
function isTextType(contentType: string, name: string): boolean {
	const base = contentType.split(";")[0]?.trim() ?? "";
	if (base.startsWith("text/")) return true;
	if (
		["application/json", "application/xml", "application/x-yaml"].includes(base)
	)
		return true;
	return /\.(log|txt|json|ya?ml|toml|md|ts|tsx|js|jsx|py|sh|sql|css|html|patch|diff)$/i.test(
		name,
	);
}

// Discord CDN URLs expire, so re-host each attachment as a Linear upload.
// Falls back to the (expiring) Discord URL when mirroring fails.
async function mirrorAttachment(
	linear: LinearClient,
	attachment: Attachment,
): Promise<Artifact> {
	const contentType = attachment.contentType ?? "application/octet-stream";
	const artifact: Artifact = {
		name: attachment.name,
		contentType,
		url: attachment.url,
		isImage: isVisionType(contentType),
	};
	if (attachment.size > MAX_UPLOAD_BYTES) return artifact;
	try {
		const res = await fetch(attachment.url);
		if (!res.ok) return artifact;
		const bytes = Buffer.from(await res.arrayBuffer());
		if (artifact.isImage && bytes.byteLength <= MAX_VISION_BYTES) {
			artifact.visionData = bytes.toString("base64");
		} else if (isTextType(contentType, attachment.name)) {
			artifact.textContent = bytes.toString("utf-8").slice(0, MAX_TEXT_CHARS);
		}
		const payload = await linear.fileUpload(
			contentType,
			attachment.name,
			bytes.byteLength,
		);
		const upload = payload.uploadFile;
		if (!upload) return artifact;
		const headers = new Headers({ "Content-Type": contentType });
		for (const h of upload.headers ?? []) headers.set(h.key, h.value);
		const put = await fetch(upload.uploadUrl, {
			method: "PUT",
			headers,
			body: bytes,
		});
		if (put.ok) artifact.url = upload.assetUrl;
	} catch (err) {
		console.error(`failed to mirror attachment ${attachment.name}`, err);
	}
	return artifact;
}

type Summary = { title: string; context: string };

const SUMMARY_SCHEMA = {
	type: "object",
	properties: {
		title: {
			type: "string",
			description: "Ticket title: specific and concrete, max 80 characters",
		},
		context: {
			type: "string",
			description:
				"2-4 sentences: what's broken or wanted and why. Outcome-focused, not solution-focused. Markdown allowed.",
		},
	},
	required: ["title", "context"],
	additionalProperties: false,
};

async function summarize(
	report: EnhanceOptions,
	artifacts: Artifact[],
): Promise<Summary | undefined> {
	if (!anthropic) return undefined;
	const images = artifacts.filter(
		(a): a is Artifact & { visionData: string } => a.visionData !== undefined,
	);
	const textFiles = artifacts.filter(
		(a): a is Artifact & { textContent: string } => a.textContent !== undefined,
	);
	const content: Anthropic.ContentBlockParam[] = [
		{
			type: "text",
			text: [
				`A user posted this report in the Superset Discord #${report.channelName} channel:`,
				"",
				`Title: ${report.title}`,
				`Report: ${report.content || "(no text — see attached files)"}`,
				...textFiles.flatMap((a) => [
					"",
					`Attached file \`${a.name}\`${a.textContent.length >= MAX_TEXT_CHARS ? " (truncated)" : ""}:`,
					"```",
					a.textContent,
					"```",
				]),
				"",
				`Write an improved ticket title and Context section for the Linear ticket. Use only details present in the report${images.length > 0 || textFiles.length > 0 ? " and the attached files/screenshots" : ""}; never invent repro steps, versions, or behavior that isn't shown.`,
			].join("\n"),
		},
		...images.map(
			(a): Anthropic.ImageBlockParam => ({
				type: "image",
				source: {
					type: "base64",
					media_type:
						a.contentType as Anthropic.Base64ImageSource["media_type"],
					data: a.visionData,
				},
			}),
		),
	];
	const response = await anthropic.messages.create({
		model: ENHANCE_MODEL,
		// Adaptive thinking shares this budget; leave headroom so JSON never truncates.
		max_tokens: 4096,
		system:
			"You groom raw Discord support reports into clear, well-scoped Linear tickets for the Superset desktop/web app team. Stay faithful to the report.",
		messages: [{ role: "user", content }],
		output_config: {
			format: { type: "json_schema", schema: SUMMARY_SCHEMA },
		},
	});
	const text = response.content.find((b) => b.type === "text")?.text;
	if (!text) return undefined;
	return JSON.parse(text) as Summary;
}

export type EnhanceOptions = {
	issueId: string;
	channelName: string;
	title: string;
	content: string;
	authorTag: string;
	messageUrl: string;
	attachments: Attachment[];
};

// Post-filing pass: mirror Discord attachments into the ticket and rewrite
// title/description with Claude. Failures leave the raw issue untouched.
export async function enhanceIssue(
	linear: LinearClient,
	opts: EnhanceOptions,
): Promise<void> {
	const artifacts = await Promise.all(
		opts.attachments.map((a) => mirrorAttachment(linear, a)),
	);
	const summary = await summarize(opts, artifacts).catch((err) => {
		console.error(`summarization failed for issue ${opts.issueId}`, err);
		return undefined;
	});
	if (!summary && artifacts.length === 0) return;

	const sections = [`## Context\n${summary?.context ?? opts.content}`.trim()];
	if (artifacts.length > 0) {
		sections.push(
			`## Artifacts\n${artifacts
				.map((a) =>
					a.isImage ? `![${a.name}](${a.url})` : `[${a.name}](${a.url})`,
				)
				.join("\n")}`,
		);
	}
	const date = new Date().toISOString().slice(0, 10);
	sections.push(
		[
			"## References",
			"| Source | Who | Link | Date |",
			"|--------|-----|------|------|",
			`| Discord #${opts.channelName} | ${opts.authorTag} | [message](${opts.messageUrl}) | ${date} |`,
		].join("\n"),
	);
	if (summary && opts.content) {
		sections.push(
			`## Original report\n> ${opts.content.split("\n").join("\n> ")}`,
		);
	}
	await linear.updateIssue(opts.issueId, {
		...(summary ? { title: summary.title } : {}),
		description: sections.join("\n\n"),
	});
	console.log(
		`enhanced issue ${opts.issueId} (${artifacts.length} artifact(s), summarized: ${Boolean(summary)})`,
	);
}
