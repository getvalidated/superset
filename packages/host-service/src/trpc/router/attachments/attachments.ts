import { z } from "zod";
import { protectedProcedure, router } from "../../index";
import {
	decodeAttachmentPayload,
	deleteAttachment,
	readAttachment,
	writeAttachment,
} from "./utils";

export const attachmentsRouter = router({
	upload: protectedProcedure
		.input(
			z.object({
				data: z.string().min(1),
				mediaType: z.string().min(1),
				originalFilename: z.string().optional(),
			}),
		)
		.mutation(({ input }) => {
			const bytes = decodeAttachmentPayload(input.data);
			const attachmentId = crypto.randomUUID();
			const { sizeBytes } = writeAttachment({
				attachmentId,
				bytes,
				mediaType: input.mediaType,
				originalFilename: input.originalFilename,
			});
			return {
				attachmentId,
				mediaType: input.mediaType,
				originalFilename: input.originalFilename,
				sizeBytes,
			};
		}),

	read: protectedProcedure
		.input(z.object({ attachmentId: z.string().min(1) }))
		.query(({ input }) => {
			const { bytes, mediaType, originalFilename, sizeBytes } = readAttachment(
				input.attachmentId,
			);
			return {
				attachmentId: input.attachmentId,
				mediaType,
				originalFilename,
				sizeBytes,
				data: bytes.toString("base64"),
			};
		}),

	delete: protectedProcedure
		.input(z.object({ attachmentId: z.string().min(1) }))
		.mutation(({ input }) => {
			deleteAttachment(input.attachmentId);
			return { success: true } as const;
		}),
});

export type AttachmentsRouter = typeof attachmentsRouter;
