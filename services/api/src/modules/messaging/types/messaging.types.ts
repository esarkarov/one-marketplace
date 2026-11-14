export interface AttachmentInput {
  fileId: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: string;
}

export type ConversationScope = "default" | "agency";

export interface SystemEventInput {
  eventType: string;
  eventPayload: Record<string, unknown>;
}
