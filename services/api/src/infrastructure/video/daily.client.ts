import { env } from "@/config/env.js";
import {
  DAILY_API_BASE,
  ROOM_TTL_SECONDS,
} from "@/infrastructure/constants/index.js";
import type {
  DailyErrorBody,
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
      privacy: "public",
      properties: {
        exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS,
        eject_at_room_exp: true,
        enable_chat: false,
      },
    }),
  });
