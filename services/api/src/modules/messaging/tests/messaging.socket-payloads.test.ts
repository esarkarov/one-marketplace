import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findAccountPublicIds: vi.fn() }));

vi.mock("@/modules/auth/index.js", () => ({
  findAccountPublicIds: mocks.findAccountPublicIds,
}));

import type { DbExecutor } from "@/database/database.types.js";
import { findClerkIdLeaks } from "@/test/support/clerk-id-scan.js";
import { loadSocketPublicIds } from "@/modules/messaging/services/messaging.socket-ids.service.js";
import {
  buildSocketPublicIds,
  toConversationUpdatePayload,
  toPresenceOfflinePayload,
  toPresenceOnlinePayload,
  toPresenceSnapshotPayload,
  toTypingUpdatePayload,
} from "@/modules/messaging/utils/messaging.socket-payloads.js";

const SELF_CLERK = "user_self";
const PARTNER_CLERK = "user_partner";
const OTHER_CLERK = "user_other";
const SELF_UUID = "11111111-1111-4111-8111-111111111111";
const PARTNER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_UUID = "33333333-3333-4333-8333-333333333333";
const AGENCY_UUID = "44444444-4444-4444-8444-444444444444";
const CLERK_IDS = [SELF_CLERK, PARTNER_CLERK, OTHER_CLERK];

const ids = buildSocketPublicIds({
  agencyIds: [AGENCY_UUID],
  rows: [
    { authId: SELF_CLERK, id: SELF_UUID },
    { authId: PARTNER_CLERK, id: PARTNER_UUID },
    { authId: OTHER_CLERK, id: OTHER_UUID },
  ],
});

describe("socket payload builders", () => {
  it("maps presence snapshot partners, keeping agency uuids", () => {
    const payload = toPresenceSnapshotPayload(ids, [
      PARTNER_CLERK,
      AGENCY_UUID,
    ]);
    expect(payload).toEqual({ userIds: [PARTNER_UUID, AGENCY_UUID] });
    expect(findClerkIdLeaks(payload, CLERK_IDS)).toEqual([]);
  });

  it("maps presence:update for a person and keeps the agency uuid for an agency room", () => {
    expect(toPresenceOnlinePayload(ids, SELF_CLERK)).toEqual({
      userId: SELF_UUID,
      online: true,
    });
    expect(toPresenceOnlinePayload(ids, AGENCY_UUID)).toEqual({
      userId: AGENCY_UUID,
      online: true,
    });
    const at = new Date("2026-01-01T00:00:00.000Z");
    const offline = toPresenceOfflinePayload(ids, AGENCY_UUID, at);
    expect(offline).toEqual({
      userId: AGENCY_UUID,
      online: false,
      lastActiveAt: at.toISOString(),
    });
    expect(
      findClerkIdLeaks(
        toPresenceOfflinePayload(ids, SELF_CLERK, at),
        CLERK_IDS,
      ),
    ).toEqual([]);
  });

  it("maps typing:update to the typing person's accounts.id", () => {
    const payload = toTypingUpdatePayload(ids, {
      conversationId: "c1",
      userId: SELF_CLERK,
      isTyping: 1,
    });
    expect(payload).toEqual({
      conversationId: "c1",
      userId: SELF_UUID,
      isTyping: true,
    });
    expect(findClerkIdLeaks(payload, CLERK_IDS)).toEqual([]);
  });

  it("carries the resolved sender uuid in conversation:update", () => {
    expect(toConversationUpdatePayload("c1", SELF_UUID)).toEqual({
      conversationId: "c1",
      messagesChanged: true,
      senderId: SELF_UUID,
    });
    expect(toConversationUpdatePayload("c1", null).senderId).toBeNull();
  });

  it("never falls back to the Clerk id when a uuid is unresolved", () => {
    const empty = buildSocketPublicIds({ agencyIds: [], rows: [] });
    expect(() => toPresenceOnlinePayload(empty, SELF_CLERK)).toThrow();
    expect(() => toPresenceSnapshotPayload(empty, [SELF_CLERK])).toThrow();
    expect(() =>
      toTypingUpdatePayload(empty, {
        conversationId: "c1",
        userId: SELF_CLERK,
        isTyping: true,
      }),
    ).toThrow();
  });
});

describe("loadSocketPublicIds", () => {
  beforeEach(() => {
    mocks.findAccountPublicIds.mockReset();
    mocks.findAccountPublicIds.mockResolvedValue(
      new Map([
        [SELF_CLERK, SELF_UUID],
        [PARTNER_CLERK, PARTNER_UUID],
      ]),
    );
  });

  const executor = {} as DbExecutor;

  it("builds the map with one batched query for the user and every partner", async () => {
    const map = await loadSocketPublicIds(executor, {
      userId: SELF_CLERK,
      agencyId: AGENCY_UUID,
      participants: [
        { userId: PARTNER_CLERK, scope: "default" },
        { userId: PARTNER_CLERK, scope: "default" },
        { userId: AGENCY_UUID, scope: "agency" },
      ],
    });

    expect(mocks.findAccountPublicIds).toHaveBeenCalledTimes(1);
    expect(mocks.findAccountPublicIds).toHaveBeenCalledWith(executor, [
      SELF_CLERK,
      PARTNER_CLERK,
      PARTNER_CLERK,
    ]);
    expect(map.get(SELF_CLERK)).toBe(SELF_UUID);
    expect(map.get(PARTNER_CLERK)).toBe(PARTNER_UUID);
    expect(map.get(AGENCY_UUID)).toBe(AGENCY_UUID);
  });

  it("runs no further query while payloads are built for many events", async () => {
    const map = await loadSocketPublicIds(executor, {
      userId: SELF_CLERK,
      agencyId: null,
      participants: [{ userId: PARTNER_CLERK, scope: "default" }],
    });
    for (let index = 0; index < 50; index += 1) {
      toPresenceOnlinePayload(map, SELF_CLERK);
      toTypingUpdatePayload(map, {
        conversationId: "c1",
        userId: SELF_CLERK,
        isTyping: true,
      });
      toPresenceSnapshotPayload(map, [PARTNER_CLERK]);
    }
    expect(mocks.findAccountPublicIds).toHaveBeenCalledTimes(1);
  });
});
