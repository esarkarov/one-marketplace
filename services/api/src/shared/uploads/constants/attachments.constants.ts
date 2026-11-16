export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_ATTACHMENT_BYTES = 14 * 1024 * 1024;
export const MAX_ATTACHMENT_FILE_NAME_LENGTH = 255;

export const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const MAX_ENCODED_LENGTH = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
export const MAX_DATA_URL_HEADER_LENGTH = 512;
export const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/;

export const CONTROL_OR_SEPARATOR_PATTERN = /[\u0000-\u001f\u007f/\\\p{Cf}]/u;

export const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  docx: DOCX_TYPE,
};
