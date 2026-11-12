import { z } from "zod";
import { ApiError } from "../http/api-error.js";

export const MAX_LIVE_URL_LENGTH = 2048;

export interface StoredImage {
  imageId: string;
  url: string;
}

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

export const liveUrlSchema = z
  .string()
  .trim()
  .max(MAX_LIVE_URL_LENGTH, { error: "Live URL is too long." })
  .refine((value) => value === "" || isHttpUrl(value), {
    error: "Live URL must be a valid http or https URL.",
  })
  .transform((value) => value || undefined);

export const parseLiveUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const result = liveUrlSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      result.error.issues[0]?.message ?? "Live URL is invalid.",
    );
  }
  return result.data;
};

export const isImageDataUrl = (value: string): boolean =>
  value.startsWith("data:image/");

export const reuseStoredImage = (
  stored: Array<StoredImage | null | undefined>,
  url: string,
): StoredImage => {
  const match = stored.find((image) => image?.url === url);
  if (!match) {
    throw new ApiError(
      400,
      "Image URL is not allowed. Upload an image or keep one of your existing images.",
    );
  }
  return { imageId: match.imageId, url: match.url };
};
