import { DOCX_TYPE } from "../constants/attachments.constants.js";
import type { DetectedFileType } from "../types/attachments.types.js";
import { ZIP_LOCAL_SIGNATURE, isPlainDocx } from "./attachment-docx.utils.js";

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

const startsWith = (bytes: Buffer, signature: number[]) =>
  signature.every((byte, index) => bytes[index] === byte);

const detectText = (bytes: Buffer): DetectedFileType => {
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

export const detectFileType = (bytes: Buffer): DetectedFileType => {
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
