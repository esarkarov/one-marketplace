import { describe, expect, it } from "vitest";
import {
  ALLOWED_ATTACHMENT_TYPES,
  assertAttachmentFileName,
  assertExtensionMatchesType,
  MAX_ATTACHMENT_BYTES,
  parseDataUrl,
  reuseStoredAttachments,
  validateAttachmentBatch,
  type StoredAttachment,
} from "./attachments.js";

const DOCX = ALLOWED_ATTACHMENT_TYPES[4];
const MB = 1024 * 1024;

const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
  ]);
const jpeg = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const pdf = (size = 32) => {
  const bytes = Buffer.alloc(size);
  bytes.write("%PDF-1.7\n");
  return bytes;
};
interface ZipEntry {
  name: string;
  size?: number;
}

interface ZipOptions {
  declaredCount?: number;
  disk?: number;
  zip64Locator?: boolean;
  zip64Size?: boolean;
}

const buildZip = (entries: ZipEntry[], options: ZipOptions = {}) => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const { name, size = 10 } of entries) {
    const nameBytes = Buffer.from(name, "latin1");
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(options.zip64Size ? 0xffffffff : size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const directory = Buffer.concat(centrals);
  const count = options.declaredCount ?? entries.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.disk ?? 0, 4);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  const locator = Buffer.alloc(options.zip64Locator ? 20 : 0);
  if (options.zip64Locator) locator.writeUInt32LE(0x07064b50, 0);

  return Buffer.concat([...locals, directory, locator, eocd]);
};

const DOCX_ENTRIES: ZipEntry[] = [
  { name: "[Content_Types].xml" },
  { name: "word/document.xml" },
];

const docx = () => buildZip(DOCX_ENTRIES);

const MISMATCH = "Attachment content does not match its file type.";
const rejectsAsDocx = (bytes: Buffer) =>
  rejection(() => validate([[DOCX, bytes]])) === MISMATCH;

const toUrl = (type: string, bytes: Buffer) =>
  `data:${type};base64,${bytes.toString("base64")}`;

const options = {
  tooManyMessage: "A message can contain up to 5 attachments.",
  nonDataMessage: "Attachment file is invalid.",
};

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  [DOCX]: "docx",
};

const validate = (items: Array<[string, Buffer]>) =>
  validateAttachmentBatch(
    items.map(([type, bytes]) => ({
      fileUrl: toUrl(type, bytes),
      mimeType: type,
      fileName: `file.${EXTENSIONS[type] ?? "bin"}`,
    })),
    options,
  );

const rejection = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as Error & { statusCode: number }).message;
  }
  return null;
};

describe("validateAttachmentBatch accepts valid files", () => {
  it.each([
    ["image/png", png()],
    ["image/jpeg", jpeg()],
    ["application/pdf", pdf()],
    [DOCX, docx()],
    ["text/plain", Buffer.from("plain text, naive café")],
  ] as const)("%s", (type, bytes) => {
    const [result] = validate([[type, bytes]]);

    expect(result).toEqual({ mimeType: type, size: bytes.byteLength });
  });

  it("compares types case-insensitively after trimming", () => {
    const [result] = validateAttachmentBatch(
      [
        {
          fileUrl: toUrl("image/png", png()),
          mimeType: " IMAGE/PNG ",
          fileName: "a.png",
        },
      ],
      options,
    );

    expect(result?.mimeType).toBe("image/png");
  });

  it("uses the decoded length as the size", () => {
    const [result] = validate([["application/pdf", pdf(1000)]]);

    expect(result?.size).toBe(1000);
  });
});

describe("validateAttachmentBatch rejects bad content and types", () => {
  it("rejects PNG bytes declared as PDF", () => {
    expect(rejection(() => validate([["application/pdf", png()]]))).toBe(
      "Attachment content does not match its file type.",
    );
  });

  it.each(["image/svg+xml", "image/svg", "text/html", "image/gif"])(
    "rejects %s as not allowed",
    (type) => {
      expect(
        rejection(() => validate([[type, Buffer.from("<svg></svg>")]])),
      ).toBe("Attachment type is not allowed.");
    },
  );

  it.each([
    "<!DOCTYPE html><html></html>",
    "  <script>alert(1)</script>",
    "<svg xmlns='x'></svg>",
    "#!/bin/sh\necho hi",
  ])("rejects markup or script text declared text/plain: %s", (text) => {
    expect(rejection(() => validate([["text/plain", Buffer.from(text)]]))).toBe(
      "Attachment type is not allowed.",
    );
  });

  it.each([
    ["MZ", Buffer.from([0x4d, 0x5a, 0x90, 0x00])],
    ["ELF", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02])],
    ["Mach-O", Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07])],
  ])("rejects %s executables declared text/plain", (_name, bytes) => {
    expect(rejection(() => validate([["text/plain", bytes]]))).toBe(
      "Attachment type is not allowed.",
    );
  });

  it("rejects text containing a NUL byte", () => {
    expect(
      rejection(() => validate([["text/plain", Buffer.from("ab\0cd")]])),
    ).toBe("Attachment content does not match its file type.");
  });

  it("rejects invalid UTF-8 text", () => {
    expect(
      rejection(() =>
        validate([["text/plain", Buffer.from([0x68, 0x69, 0xc3, 0x28])]]),
      ),
    ).toBe("Attachment content does not match its file type.");
  });

  it("rejects a zip without word/ declared as DOCX", () => {
    const zip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("xl/workbook.xml"),
    ]);

    expect(rejection(() => validate([[DOCX, zip]]))).toBe(
      "Attachment content does not match its file type.",
    );
  });

  it("rejects a plain word/ string in non-zip bytes", () => {
    expect(rejectsAsDocx(Buffer.from("word/document.xml"))).toBe(true);
  });

  it("rejects a PK header followed by garbage", () => {
    const garbage = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("word/document.xml [Content_Types].xml".repeat(4)),
    ]);

    expect(rejectsAsDocx(garbage)).toBe(true);
  });

  it("rejects a zip without word/document.xml", () => {
    expect(rejectsAsDocx(buildZip([DOCX_ENTRIES[0]!]))).toBe(true);
  });

  it("rejects a zip without [Content_Types].xml", () => {
    expect(rejectsAsDocx(buildZip([DOCX_ENTRIES[1]!]))).toBe(true);
  });

  it("rejects an xlsx-like zip", () => {
    expect(
      rejectsAsDocx(
        buildZip([
          { name: "[Content_Types].xml" },
          { name: "xl/workbook.xml" },
        ]),
      ),
    ).toBe(true);
  });

  it("rejects a macro-enabled docm", () => {
    expect(
      rejectsAsDocx(
        buildZip([...DOCX_ENTRIES, { name: "word/vbaProject.bin" }]),
      ),
    ).toBe(true);
  });

  it.each(["../evil.txt", "word/../../evil.txt", "/abs.txt", "\\abs.txt"])(
    "rejects the entry name %s",
    (name) => {
      expect(rejectsAsDocx(buildZip([...DOCX_ENTRIES, { name }]))).toBe(true);
    },
  );

  it("rejects a drive-letter entry name and backslash separators", () => {
    expect(
      rejectsAsDocx(buildZip([...DOCX_ENTRIES, { name: "C:evil.txt" }])),
    ).toBe(true);
    expect(
      rejectsAsDocx(buildZip([...DOCX_ENTRIES, { name: "word\\evil.xml" }])),
    ).toBe(true);
  });

  it("accepts exactly 1000 entries and rejects 1001", () => {
    const filler = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ name: `f/${index}.xml` }));

    expect(rejectsAsDocx(buildZip([...DOCX_ENTRIES, ...filler(998)]))).toBe(
      false,
    );
    expect(rejectsAsDocx(buildZip([...DOCX_ENTRIES, ...filler(999)]))).toBe(
      true,
    );
  });

  it("rejects a declared uncompressed total over 100 MB", () => {
    const big = 60 * MB;

    expect(
      rejectsAsDocx(
        buildZip([
          { name: "[Content_Types].xml", size: big },
          { name: "word/document.xml", size: big },
        ]),
      ),
    ).toBe(true);
  });

  it("rejects a truncated or inconsistent central directory", () => {
    const whole = docx();

    expect(rejectsAsDocx(whole.subarray(0, whole.length - 22))).toBe(true);
    expect(rejectsAsDocx(buildZip(DOCX_ENTRIES, { declaredCount: 3 }))).toBe(
      true,
    );
  });

  it("rejects multi-disk and zip64 archives", () => {
    expect(rejectsAsDocx(buildZip(DOCX_ENTRIES, { disk: 1 }))).toBe(true);
    expect(rejectsAsDocx(buildZip(DOCX_ENTRIES, { zip64Locator: true }))).toBe(
      true,
    );
    expect(rejectsAsDocx(buildZip(DOCX_ENTRIES, { zip64Size: true }))).toBe(
      true,
    );
  });

  it("rejects when the data URL header type differs from the declared type", () => {
    const message = rejection(() =>
      validateAttachmentBatch(
        [
          {
            fileUrl: toUrl("image/png", png()),
            mimeType: "application/pdf",
            fileName: "a.pdf",
          },
        ],
        options,
      ),
    );

    expect(message).toBe("Attachment content does not match its file type.");
  });

  it("rejects non-data URLs with the configured message", () => {
    const message = rejection(() =>
      validateAttachmentBatch(
        [
          {
            fileUrl: "https://example.com/a.pdf",
            mimeType: "application/pdf",
            fileName: "a.pdf",
          },
        ],
        options,
      ),
    );

    expect(message).toBe("Attachment file is invalid.");
  });

  it("skips non-data URLs when stored attachments are allowed", () => {
    const result = validateAttachmentBatch(
      [
        {
          fileUrl: "https://ik.example/a.pdf",
          mimeType: "text/csv",
          fileName: "a.pdf",
        },
      ],
      { ...options, nonDataMessage: null },
    );

    expect(result).toEqual([null]);
  });
});

describe("parseDataUrl", () => {
  const base64 = pdf().toString("base64");

  it.each([
    ["missing base64", `data:application/pdf,${base64}`],
    ["extra parameters", `data:application/pdf;charset=utf-8;base64,${base64}`],
    [
      "whitespace",
      `data:application/pdf;base64,${base64.slice(0, 8)} ${base64.slice(8)}`,
    ],
    ["trailing newline", `data:application/pdf;base64,${base64}\n`],
    [
      "embedded newline",
      `data:application/pdf;base64,${base64.slice(0, 8)}\n${base64.slice(8)}`,
    ],
    ["bad characters", "data:application/pdf;base64,@@@@"],
    ["url-safe alphabet", "data:application/pdf;base64,ab-_"],
    ["unpadded", "data:application/pdf;base64,QUJD" + "RA"],
    ["empty payload", "data:application/pdf;base64,"],
    ["missing type", `data:;base64,${base64}`],
  ])("rejects %s", (_name, value) => {
    expect(rejection(() => parseDataUrl(value))).toBe(
      "Attachment file is invalid.",
    );
  });

  it("computes the size from the encoded length", () => {
    expect(parseDataUrl(toUrl("application/pdf", pdf(10))).size).toBe(10);
    expect(parseDataUrl(toUrl("application/pdf", pdf(11))).size).toBe(11);
    expect(parseDataUrl(toUrl("application/pdf", pdf(12))).size).toBe(12);
  });

  it("rejects an oversized string before matching or decoding it", () => {
    const huge = "data:application/pdf;base64," + "A".repeat(8 * MB);

    expect(rejection(() => parseDataUrl(huge))).toBe(
      "Each attachment must be 5 MB or smaller.",
    );
  });
});

describe("size and count limits", () => {
  it("accepts exactly 5 MB and rejects one byte more", () => {
    expect(
      validate([["application/pdf", pdf(MAX_ATTACHMENT_BYTES)]]),
    ).toHaveLength(1);
    expect(
      rejection(() =>
        validate([["application/pdf", pdf(MAX_ATTACHMENT_BYTES + 1)]]),
      ),
    ).toBe("Each attachment must be 5 MB or smaller.");
  });

  it("ignores any client-sent size and rejects 6 attachments", () => {
    const items: Array<[string, Buffer]> = Array.from({ length: 6 }, () => [
      "application/pdf",
      pdf(),
    ]);

    expect(rejection(() => validate(items))).toBe(
      "A message can contain up to 5 attachments.",
    );
  });

  it("rejects 15 MB in total and accepts 14 MB", () => {
    const total = "Attachments are too large in total (14 MB maximum).";

    expect(
      rejection(() =>
        validate([
          ["application/pdf", pdf(5 * MB)],
          ["application/pdf", pdf(5 * MB)],
          ["application/pdf", pdf(5 * MB)],
        ]),
      ),
    ).toBe(total);
    expect(
      validate([
        ["application/pdf", pdf(5 * MB)],
        ["application/pdf", pdf(5 * MB)],
        ["application/pdf", pdf(4 * MB)],
      ]),
    ).toHaveLength(3);
  });
});

describe("assertAttachmentFileName", () => {
  it.each(["report.pdf", "my file (1).docx"])("accepts %s", (name) => {
    expect(rejection(() => assertAttachmentFileName(name))).toBeNull();
  });

  it.each(["a/b.pdf", "a\\b.pdf", "a\nb.pdf", "a\0b.pdf", "a\u007fb.pdf"])(
    "rejects control characters and separators in %j",
    (name) => {
      expect(rejection(() => assertAttachmentFileName(name))).toBe(
        "Attachment name is invalid.",
      );
    },
  );

  it("rejects names longer than 255 characters", () => {
    expect(rejection(() => assertAttachmentFileName("a".repeat(256)))).toBe(
      "Attachment name must be 255 characters or fewer.",
    );
    expect(
      rejection(() => assertAttachmentFileName("a".repeat(255))),
    ).toBeNull();
  });
});

describe("assertExtensionMatchesType", () => {
  it.each([
    ["a.pdf", "application/pdf"],
    ["a.PNG", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.b.txt", "text/plain"],
    ["a.docx", DOCX],
  ])("accepts %s as %s", (name, type) => {
    expect(rejection(() => assertExtensionMatchesType(name, type))).toBeNull();
  });

  it.each([
    ["a.png", "application/pdf"],
    ["a.exe", "text/plain"],
    ["a.jpg", "image/png"],
  ])("rejects %s as %s", (name, type) => {
    expect(rejection(() => assertExtensionMatchesType(name, type))).toBe(
      "Attachment file extension does not match its content.",
    );
  });

  it.each(["a", "a.", ".pdf"])("rejects %j with no extension", (name) => {
    expect(
      rejection(() => assertExtensionMatchesType(name, "application/pdf")),
    ).toBe("Attachment name must have a file extension.");
  });
});

describe("assertAttachmentFileName invisible characters", () => {
  it.each([
    "a‮b.pdf",
    "a‪b.pdf",
    "a⁦b.pdf",
    "a⁩b.pdf",
    "a‎b.pdf",
    "a‏b.pdf",
    "a؜b.pdf",
    "a​b.pdf",
    "a‍b.pdf",
    "a⁠b.pdf",
    "a﻿b.pdf",
    "a­b.pdf",
  ])("rejects %j", (name) => {
    expect(rejection(() => assertAttachmentFileName(name))).toBe(
      "Attachment name is invalid.",
    );
  });
});

describe("reuseStoredAttachments", () => {
  const stored: StoredAttachment[] = [
    {
      fileId: "file_1",
      fileName: "brief.pdf",
      fileUrl: "https://ik.example/brief.pdf",
      fileType: "application/pdf",
      fileSize: 1234,
    },
  ];
  const incoming = (over: Partial<StoredAttachment> = {}) => ({
    fileId: "file_1",
    fileName: "renamed.exe",
    fileUrl: "https://ik.example/brief.pdf",
    fileType: "application/x-msdownload",
    fileSize: 999999,
    ...over,
  });

  it("replaces a matching attachment with the stored record", () => {
    expect(reuseStoredAttachments(stored, [incoming()])).toEqual(stored);
  });

  it("passes data URLs through unchanged", () => {
    const upload = incoming({
      fileId: "",
      fileUrl: "data:text/plain;base64,QQ==",
    });

    expect(reuseStoredAttachments(stored, [upload])).toEqual([upload]);
  });

  it.each([
    ["a different file id", { fileId: "file_2" }],
    ["a different url", { fileUrl: "https://evil.example/brief.pdf" }],
    ["a javascript url", { fileUrl: "javascript:alert(1)" }],
  ])("rejects %s", (_name, over) => {
    expect(
      rejection(() => reuseStoredAttachments(stored, [incoming(over)])),
    ).toBe("Attachment URL is not allowed.");
  });

  it("rejects everything when the record has no stored attachments", () => {
    expect(rejection(() => reuseStoredAttachments([], [incoming()]))).toBe(
      "Attachment URL is not allowed.",
    );
  });
});
