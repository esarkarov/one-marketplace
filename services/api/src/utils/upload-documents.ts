import { env } from "../config/env.js";
import { imageKit } from "../config/imageKit.js";
import { ApiError } from "./api-error.js";

type Document = { fileId: string; fileName: string; fileUrl: string };

export const deleteDocuments = (
  documents: Array<{ fileId: string } | string> = [],
) =>
  Promise.allSettled(
    documents.map((document) =>
      imageKit.files.delete(
        typeof document === "string" ? document : document.fileId,
      ),
    ),
  );

export const uploadDocuments = async <T extends Document>(
  folder: string,
  documents: T[],
) => {
  const uploaded: T[] = [];
  const uploadedIds: string[] = [];

  try {
    for (const document of documents) {
      if (!document.fileUrl.startsWith("data:")) {
        uploaded.push(document);
        continue;
      }

      if (!env.imageKitPrivateKey) {
        throw new ApiError(503, "Document uploads are not configured.");
      }

      const file = await imageKit.files.upload({
        file: document.fileUrl,
        fileName: document.fileName,
        folder,
      });

      if (!file.fileId || !file.url) {
        throw new ApiError(502, "Document upload failed.");
      }

      uploaded.push({ ...document, fileId: file.fileId, fileUrl: file.url });
      uploadedIds.push(file.fileId);
    }

    return { documents: uploaded, uploadedIds };
  } catch (error) {
    await deleteDocuments(uploadedIds);
    throw error;
  }
};
