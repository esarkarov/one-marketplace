import { env } from "@/config/env.js";
import {
  DAILY_API_BASE,
  ROOM_TOKEN_EXPIRY_MARGIN_SECONDS,
  ROOM_TTL_SECONDS,
} from "@/infrastructure/constants/index.js";
import type { ExternalPolicyKey } from "@/infrastructure/types/external-call.types.js";
import type {
  DailyErrorBody,
  DailyMeetingToken,
  DailyRoom,
} from "@/infrastructure/types/index.js";
import {
  callExternal,
  ExternalCallError,
} from "@/infrastructure/utils/external-call.utils.js";

export class DailyRequestError extends Error {
  readonly status: number | undefined;
  readonly timedOut: boolean;

  constructor(
    message: string,
    details: { status?: number; timedOut: boolean; cause?: unknown },
  ) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.name = "DailyRequestError";
    this.status = details.status;
    this.timedOut = details.timedOut;
  }
}

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

const DAILY_TIMEOUT_MESSAGE = "Daily API request timed out.";

const dailyRequestOnce = async <T>(
  path: string,
  init: RequestInit,
  apiKey: string,
  signal: AbortSignal,
): Promise<T> => {
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${DAILY_API_BASE}${path}`, {
      ...init,
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    body = await response.json().catch((error: unknown) => {
      if (isTimeoutError(error)) throw error;
      return null;
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new DailyRequestError(DAILY_TIMEOUT_MESSAGE, {
        timedOut: true,
      });
    }
    throw error;
  }

  if (!response.ok) {
    const errorBody = body as DailyErrorBody | null;
    const message =
      errorBody?.info ??
      errorBody?.error ??
      `Daily API request failed (${response.status}).`;
    throw new DailyRequestError(message, {
      status: response.status,
      timedOut: false,
    });
  }

  return body as T;
};

const toDailyError = (error: unknown): unknown => {
  if (!(error instanceof ExternalCallError)) return error;
  if (error.kind === "aborted") return error;
  if (error.kind === "timeout") {
    return new DailyRequestError(DAILY_TIMEOUT_MESSAGE, {
      timedOut: true,
      cause: error,
    });
  }
  if (error.cause instanceof DailyRequestError) {
    return new DailyRequestError(error.cause.message, {
      ...(error.cause.status === undefined
        ? {}
        : { status: error.cause.status }),
      timedOut: error.cause.timedOut,
      cause: error,
    });
  }
  return error.cause;
};

const dailyRequest = async <T>(
  policyKey: ExternalPolicyKey,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const apiKey = env.dailyApiKey;
  if (!apiKey) {
    throw new Error("DAILY_API_KEY is missing from the environment.");
  }
  try {
    return await callExternal(policyKey, (signal) =>
      dailyRequestOnce<T>(path, init, apiKey, signal),
    );
  } catch (error) {
    throw toDailyError(error);
  }
};

export const createDailyRoom = (roomName: string): Promise<DailyRoom> =>
  dailyRequest<DailyRoom>("daily.createRoom", "/rooms", {
    method: "POST",
    body: JSON.stringify({
      name: roomName,
      privacy: "private",
      properties: {
        exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS,
        eject_at_room_exp: true,
        enable_chat: false,
      },
    }),
  });

interface DailyMeetingTokenInput {
  roomName: string;
  userId: string;
  userName: string;
  expiresAt: number;
}

export const createDailyMeetingToken = (
  input: DailyMeetingTokenInput,
): Promise<DailyMeetingToken> =>
  dailyRequest<DailyMeetingToken>("daily.createToken", "/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: input.roomName,
        is_owner: false,
        user_name: input.userName,
        user_id: input.userId,
        exp: input.expiresAt,
      },
    }),
  });

interface DailyJoinUrlInput {
  roomName: string;
  roomUrl: string;
  startedAt: Date;
  userId: string;
  userName: string;
}

export const createDailyJoinUrl = async (
  input: DailyJoinUrlInput,
): Promise<string> => {
  const expiresAt =
    Math.floor(input.startedAt.getTime() / 1000) +
    ROOM_TTL_SECONDS -
    ROOM_TOKEN_EXPIRY_MARGIN_SECONDS;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return input.roomUrl;

  const { token } = await createDailyMeetingToken({
    roomName: input.roomName,
    userId: input.userId,
    userName: input.userName,
    expiresAt,
  });
  const url = new URL(input.roomUrl);
  url.searchParams.set("t", token);
  return url.toString();
};
