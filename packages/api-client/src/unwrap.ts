import { ApiError, apiErrorFromResponse } from "./errors";

type FetchResult<D, E> =
  | { data: D; error?: never; response: Response }
  | { data?: never; error: E; response: Response };

type EnvelopeData<D> = D extends { success: true; data: infer T } ? T : never;

const isSuccessEnvelope = (body: unknown): body is { data: unknown } =>
  typeof body === "object" &&
  body !== null &&
  (body as { success?: unknown }).success === true &&
  "data" in body;

/**
 * Returns `data` from the `{ success: true, message, data }` envelope and
 * throws ApiError for an error response or a body that is not a success envelope.
 */
export const unwrap = async <D, E>(
  result: Promise<FetchResult<D, E>>,
): Promise<EnvelopeData<D>> => {
  const settled = await result;

  if (settled.error !== undefined) {
    throw apiErrorFromResponse(settled.response.status, settled.error);
  }

  const body: unknown = settled.data;

  if (isSuccessEnvelope(body)) {
    return body.data as EnvelopeData<D>;
  }

  const failure = apiErrorFromResponse(settled.response.status, body);

  if (failure.code !== "HTTP_ERROR") throw failure;

  throw new ApiError({
    status: settled.response.status,
    code: "UNEXPECTED_RESPONSE",
    message: "The server answered with an unexpected response.",
  });
};
