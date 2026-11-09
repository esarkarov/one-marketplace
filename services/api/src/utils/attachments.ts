import { ApiError } from "./api-error.js";

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

export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

const MAX_ENCODED_LENGTH = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
const MAX_DATA_URL_HEADER_LENGTH = 512;
const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EXECUTABLE_SIGNATURES = [
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
];
const MARKUP_PATTERN = /<\s*(!doctype|html|head|body|script|svg|iframe)/i;
const CONTROL_OR_SEPARATOR_PATTERN = /[\u0000-\u001f\u007f/\\]/;

const reject = (message: string): never => {
  throw new ApiError(400, message);
};

const isAllowedType = (value: string): value is AllowedAttachmentType =>
  (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(value);

const startsWith = (bytes: Buffer, signature: number[]) =>
  signature.every((byte, index) => bytes[index] === byte);

export const normalizeMimeType = (value: string) => value.trim().toLowerCase();

export const isDataUrl = (value: string) => value.startsWith("data:");

export interface ParsedDataUrl {
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

type Detected = AllowedAttachmentType | "blocked" | null;

const detectText = (bytes: Buffer): Detected => {
  if (bytes.includes(0)) return null;

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  const head = text.replace(/^﻿/, "").trimStart();
  if (head.startsWith("#!")) return "blocked";
  if (MARKUP_PATTERN.test(head.slice(0, 512))) return "blocked";

  return "text/plain";
};

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ZIP_LOCAL_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
const EOCD_SEARCH_LENGTH = 65557;
const CENTRAL_ENTRY_MIN_LENGTH = 46;
const MAX_ZIP_ENTRIES = 1000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const ZIP64_MARKER = 0xffffffff;
const ZIP64_COUNT_MARKER = 0xffff;
const ABSOLUTE_PATH_PATTERN = /^(?:[/\\]|[A-Za-z]:)/;

const findEndOfCentralDirectory = (bytes: Buffer): number => {
  const lowest = Math.max(0, bytes.length - EOCD_SEARCH_LENGTH);
  for (
    let offset = bytes.length - EOCD_MIN_LENGTH;
    offset >= lowest;
    offset--
  ) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
};

const isUnsafeEntryName = (name: string) =>
  name.includes("vbaProject.bin") ||
  name.includes("\\") ||
  ABSOLUTE_PATH_PATTERN.test(name) ||
  name.split("/").includes("..");

const isPlainDocx = (bytes: Buffer): boolean => {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) return false;

  if (
    eocd >= 20 &&
    bytes.readUInt32LE(eocd - 20) === EOCD64_LOCATOR_SIGNATURE
  ) {
    return false;
  }

  const diskNumber = bytes.readUInt16LE(eocd + 4);
  const centralDirectoryDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) return false;
  if (entriesOnDisk !== entryCount) return false;
  if (
    entryCount === ZIP64_COUNT_MARKER ||
    directorySize === ZIP64_MARKER ||
    directoryOffset === ZIP64_MARKER
  ) {
    return false;
  }
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) return false;
  if (directoryOffset + directorySize > eocd) return false;

  const directoryEnd = directoryOffset + directorySize;
  let cursor = directoryOffset;
  let totalUncompressed = 0;
  const names = new Set<string>();

  for (let index = 0; index < entryCount; index++) {
    if (cursor + CENTRAL_ENTRY_MIN_LENGTH > directoryEnd) return false;
    if (bytes.readUInt32LE(cursor) !== CENTRAL_ENTRY_SIGNATURE) return false;

    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const entryDisk = bytes.readUInt16LE(cursor + 34);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);

    if (
      compressedSize === ZIP64_MARKER ||
      uncompressedSize === ZIP64_MARKER ||
      localHeaderOffset === ZIP64_MARKER ||
      entryDisk !== 0
    ) {
      return false;
    }

    const next =
      cursor +
      CENTRAL_ENTRY_MIN_LENGTH +
      nameLength +
      extraLength +
      commentLength;
    if (next > directoryEnd) return false;

    const name = bytes.toString(
      "latin1",
      cursor + CENTRAL_ENTRY_MIN_LENGTH,
      cursor + CENTRAL_ENTRY_MIN_LENGTH + nameLength,
    );
    if (isUnsafeEntryName(name)) return false;

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) return false;

    names.add(name);
    cursor = next;
  }

  return names.has("[Content_Types].xml") && names.has("word/document.xml");
};

export const detectFileType = (bytes: Buffer): Detected => {
  if (EXECUTABLE_SIGNATURES.some((signature) => startsWith(bytes, signature))) {
    return "blocked";
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ZIP_LOCAL_SIGNATURE)) {
    return isPlainDocx(bytes) ? DOCX_TYPE : null;
  }

  return detectText(bytes);
};

export const assertContentMatchesType = (
  bytes: Buffer,
  declaredType: string,
) => {
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

export interface AttachmentBatchItem {
  fileUrl: string;
  mimeType: string;
}

export interface AttachmentBatchOptions {
  tooManyMessage: string;
  nonDataMessage: string | null;
}

export interface ValidatedAttachment {
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

  return parsed.map((data) => {
    if (!data) return null;
    assertContentMatchesType(Buffer.from(data.base64, "base64"), data.mimeType);
    return { mimeType: data.mimeType, size: data.size };
  });
};

export interface StoredAttachment {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
}

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
