import {
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_MEDIA_TYPE_TO_EXT: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"text/plain": "txt",
	"text/markdown": "md",
	"application/json": "json",
	"application/pdf": "pdf",
};

export function attachmentsRoot(): string {
	return join(homedir(), ".superset", "attachments");
}

export function attachmentDir(attachmentId: string): string {
	return join(attachmentsRoot(), attachmentId);
}

export function decodeAttachmentPayload(data: string): Buffer {
	const commaIdx = data.indexOf(",");
	const base64 =
		data.startsWith("data:") && commaIdx >= 0
			? data.slice(commaIdx + 1)
			: data;
	return Buffer.from(base64, "base64");
}

export function writeAttachment(args: {
	attachmentId: string;
	bytes: Buffer;
	mediaType: string;
	originalFilename?: string;
}): { sizeBytes: number } {
	const ext = ATTACHMENT_MEDIA_TYPE_TO_EXT[args.mediaType];
	if (!ext) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Unsupported media type "${args.mediaType}"`,
		});
	}
	if (args.bytes.length > ATTACHMENT_MAX_BYTES) {
		throw new TRPCError({
			code: "PAYLOAD_TOO_LARGE",
			message: `Attachment exceeds ${ATTACHMENT_MAX_BYTES} byte limit (got ${args.bytes.length})`,
		});
	}
	const dir = attachmentDir(args.attachmentId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${args.attachmentId}.${ext}`), args.bytes);
	writeFileSync(
		join(dir, "metadata.json"),
		JSON.stringify(
			{
				attachmentId: args.attachmentId,
				mediaType: args.mediaType,
				originalFilename: args.originalFilename ?? null,
				sizeBytes: args.bytes.length,
				createdAt: Date.now(),
			},
			null,
			2,
		),
	);
	return { sizeBytes: args.bytes.length };
}

export function deleteAttachment(attachmentId: string): void {
	rmSync(attachmentDir(attachmentId), { recursive: true, force: true });
}

export function attachmentExists(attachmentId: string): boolean {
	try {
		return statSync(attachmentDir(attachmentId)).isDirectory();
	} catch {
		return false;
	}
}

export function readAttachment(attachmentId: string): {
	bytes: Buffer;
	mediaType: string;
	originalFilename: string | null;
	sizeBytes: number;
} {
	const dir = attachmentDir(attachmentId);
	let metadata: {
		mediaType: string;
		originalFilename: string | null;
		sizeBytes: number;
	};
	try {
		metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
	} catch {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Attachment "${attachmentId}" not found`,
		});
	}
	const ext = ATTACHMENT_MEDIA_TYPE_TO_EXT[metadata.mediaType];
	if (!ext) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Stored attachment has unsupported media type "${metadata.mediaType}"`,
		});
	}
	const bytes = readFileSync(join(dir, `${attachmentId}.${ext}`));
	return {
		bytes,
		mediaType: metadata.mediaType,
		originalFilename: metadata.originalFilename,
		sizeBytes: metadata.sizeBytes,
	};
}

export function resolveAttachmentPath(attachmentId: string): {
	path: string;
	mediaType: string;
} | null {
	const dir = attachmentDir(attachmentId);
	let metadata: { mediaType: string };
	try {
		metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
	} catch {
		return null;
	}
	const ext = ATTACHMENT_MEDIA_TYPE_TO_EXT[metadata.mediaType];
	if (!ext) return null;
	const path = join(dir, `${attachmentId}.${ext}`);
	try {
		statSync(path);
		return { path, mediaType: metadata.mediaType };
	} catch {
		return null;
	}
}
