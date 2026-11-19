import { ApiError } from "@/shared/errors/api-error.js";
import {
  ALLOWED_ATTACHMENT_TYPES,
  CONTROL_OR_SEPARATOR_PATTERN,
  DATA_URL_PATTERN,
  EXTENSION_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS,
  MAX_DATA_URL_HEADER_LENGTH,
  MAX_ENCODED_LENGTH,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "./constants/attachments.constants.js";
import type {
  AllowedAttachmentType,
  StoredAttachment,
} from "./types/attachments.types.js";
import { detectFileType } from "./utils/attachment-file-type.utils.js";

const reject = (message: string): never => {
  throw new ApiError(400, message);
};

const isAllowedType = (value: string): value is AllowedAttachmentType =>
  (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(value);

const normalizeMimeType = (value: string) => value.trim().toLowerCase();

const isDataUrl = (value: string) => value.startsWith("data:");

interface ParsedDataUrl {
  mimeType: string;
  base64: string;
  size: number;
}

export const parseDataUrl = (value: string): ParsedDataUrl => {
  if (value.length > MAX_ENCODED_LENGTH + MAX_DATA_URL_HEADER_LENGTH) {
    return reject("Each attachment must be 5 MB or smaller.");
  }

  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return reject("Attachment file is invalid.");

  const base64 = match[2]!;
  if (base64.length % 4 !== 0) return reject("Attachment file is invalid.");

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return {
    mimeType: normalizeMimeType(match[1]!),
    base64,
    size: (base64.length / 4) * 3 - padding,
  };
};

const assertContentMatchesType = (bytes: Buffer, declaredType: string) => {
  const detected = detectFileType(bytes);

  if (detected === "blocked") reject("Attachment type is not allowed.");
  if (detected !== declaredType) {
    reject("Attachment content does not match its file type.");
  }
};

export const assertAttachmentFileName = (fileName: string) => {
  if (fileName.length > MAX_ATTACHMENT_FILE_NAME_LENGTH) {
    reject("Attachment name must be 255 characters or fewer.");
  }
  if (CONTROL_OR_SEPARATOR_PATTERN.test(fileName)) {
    reject("Attachment name is invalid.");
  }
};

export const assertExtensionMatchesType = (
  fileName: string,
  detectedType: string,
) => {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) {
    reject("Attachment name must have a file extension.");
  }

  const extension = fileName.slice(dot + 1).toLowerCase();
  if (EXTENSION_TYPES[extension] !== detectedType) {
    reject("Attachment file extension does not match its content.");
  }
};

interface AttachmentBatchItem {
  fileUrl: string;
  mimeType: string;
  fileName: string;
}

interface AttachmentBatchOptions {
  tooManyMessage: string;
  nonDataMessage: string | null;
}

interface ValidatedAttachment {
  mimeType: string;
  size: number;
}

export const validateAttachmentBatch = (
  items: AttachmentBatchItem[],
  { tooManyMessage, nonDataMessage }: AttachmentBatchOptions,
): Array<ValidatedAttachment | null> => {
  if (items.length > MAX_ATTACHMENTS) reject(tooManyMessage);

  const parsed = items.map((item) => {
    if (!isDataUrl(item.fileUrl)) {
      if (nonDataMessage === null) return null;
      return reject(nonDataMessage);
    }

    const declaredType = normalizeMimeType(item.mimeType);
    if (!isAllowedType(declaredType)) {
      return reject("Attachment type is not allowed.");
    }

    const data = parseDataUrl(item.fileUrl);
    if (data.mimeType !== declaredType) {
      return reject("Attachment content does not match its file type.");
    }
    if (data.size > MAX_ATTACHMENT_BYTES) {
      return reject("Each attachment must be 5 MB or smaller.");
    }

    return data;
  });

  const total = parsed.reduce((sum, data) => sum + (data?.size ?? 0), 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    reject("Attachments are too large in total (14 MB maximum).");
  }

  return parsed.map((data, index) => {
    if (!data) return null;
    assertContentMatchesType(Buffer.from(data.base64, "base64"), data.mimeType);
    assertExtensionMatchesType(items[index]!.fileName, data.mimeType);
    return { mimeType: data.mimeType, size: data.size };
  });
};

export const reuseStoredAttachments = <
  T extends { fileId: string; fileUrl: string },
>(
  stored: StoredAttachment[],
  incoming: T[],
): Array<T | StoredAttachment> =>
  incoming.map((attachment) => {
    if (isDataUrl(attachment.fileUrl)) return attachment;

    const match = stored.find(
      ({ fileId, fileUrl }) =>
        fileId === attachment.fileId && fileUrl === attachment.fileUrl,
    );
    if (!match) return reject("Attachment URL is not allowed.");

    return match;
  });
