interface MessageAttachmentRow {
  id: string;
  message_id: string;
  storage_key: string;
  file_url: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  attachment_type: string;
  is_available: boolean;
  created_at: Date;
}

export const toMessageAttachmentResponse = (
  attachment: MessageAttachmentRow,
) => ({
  id: attachment.id,
  messageId: attachment.message_id,
  storageKey: attachment.storage_key,
  fileUrl: attachment.file_url,
  fileName: attachment.file_name,
  mimeType: attachment.mime_type,
  fileSize: attachment.file_size,
  attachmentType: attachment.attachment_type,
  isAvailable: attachment.is_available,
  createdAt: attachment.created_at,
});
