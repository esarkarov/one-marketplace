import { env } from "@/config/env.js";
import {
  DAILY_API_BASE,
  ROOM_TOKEN_EXPIRY_MARGIN_SECONDS,
  ROOM_TTL_SECONDS,
} from "@/infrastructure/constants/index.js";
import type {
  DailyErrorBody,
  DailyMeetingToken,
  DailyRoom,
} from "@/infrastructure/types/index.js";

const dailyRequest = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  if (!env.dailyApiKey) {
    throw new Error("DAILY_API_KEY is missing from the environment.");
  }

  const response = await fetch(`${DAILY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.dailyApiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = body as DailyErrorBody | null;
    const message =
      errorBody?.info ??
      errorBody?.error ??
      `Daily API request failed (${response.status}).`;
    throw new Error(message);
  }

  return body as T;
};

export const createDailyRoom = (roomName: string): Promise<DailyRoom> =>
  dailyRequest<DailyRoom>("/rooms", {
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
  dailyRequest<DailyMeetingToken>("/meeting-tokens", {
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
