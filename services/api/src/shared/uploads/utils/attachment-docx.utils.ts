export const ZIP_LOCAL_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
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

export const isPlainDocx = (bytes: Buffer): boolean => {
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
