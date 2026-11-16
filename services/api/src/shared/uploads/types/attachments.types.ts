import type { ALLOWED_ATTACHMENT_TYPES } from "../constants/attachments.constants.js";

export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

export type DetectedFileType = AllowedAttachmentType | "blocked" | null;

export interface StoredAttachment {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
}
