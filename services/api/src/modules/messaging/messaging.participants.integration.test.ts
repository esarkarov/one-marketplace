import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: {
    users: { getUser: vi.fn().mockRejectedValue(new Error("clerk down")) },
  },
}));

vi.mock("./messaging.socket.js", () => ({
  emitConversationUpdate: vi.fn(),
}));

import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  client_metadata,
  conversation_participants,
  conversations,
  freelancer_metadata,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { createConversation, getConversations } from "./messaging.service.js";

const PREFIX = "msg-part-it-";

const purgeLeftovers = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const countLeftovers = async () => {
  const result = await pool.query<{ total: string }>(
    `select (
       (select count(*) from accounts where auth_id like $1) +
       (select count(*) from client_metadata where auth_id like $1) +
       (select count(*) from freelancer_metadata where auth_id like $1) +
       (select count(*) from conversations where context_key like $1)
     )::text as total`,
    [`${PREFIX}%`],
  );
  return Number(result.rows[0]?.total ?? 0);
};

const createAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = `${PREFIX}${randomUUID()}`;
  const email = `${authId}@example.test`;
  await db.insert(accounts).values({
    auth_id: authId,
    email,
    role,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return { authId, email };
};

const collectKeys = (value: unknown, keys = new Set<string>()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purgeLeftovers();
});

afterAll(async () => {
  await purgeLeftovers();
  const leftovers = await countLeftovers();
  await pool.end();
  expect(leftovers).toBe(0);
});

describe("messaging participant profiles", () => {
  it("returns only public participant fields", async () => {
    const client = await createAccount("CLIENT");
    const freelancer = await createAccount("FREELANCER");
    const agencyOwner = await createAccount("FREELANCER");
    await db.insert(client_metadata).values({
      auth_id: client.authId,
      role: "CLIENT",
      company_name: "Acme Test Co",
      company_website: "https://acme.example.test",
      company_size: "1-10",
      industry: "testing",
      company_description: "integration",
    });
    await db.insert(freelancer_metadata).values({
      auth_id: freelancer.authId,
      professional_title: "Staff Engineer",
      professional_description: "integration",
      hourly_rate_cents: 5000,
      country: "US",
      city: "Austin",
      weekly_availability: "30",
      experience_level: "INTERMEDIATE",
      languages: [],
    });
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: agencyOwner.authId,
        name: "Agency Visible Name",
        size: "1-10",
        specialty: "testing",
        overview: "integration",
        avatar_image: {
          imageId: "img",
          url: "https://img.example.test/a.png",
        },
      })
      .returning({ id: agency_metadata.id });

    const [direct] = await db
      .insert(conversations)
      .values({ context_key: `${PREFIX}${randomUUID()}` })
      .returning({ id: conversations.id });
    await db.insert(conversation_participants).values([
      {
        conversation_id: direct!.id,
        account_id: client.authId,
        participant_type: "CLIENT",
      },
      {
        conversation_id: direct!.id,
        account_id: freelancer.authId,
        participant_type: "FREELANCER",
      },
    ]);
    const [viaAgency] = await db
      .insert(conversations)
      .values({ context_key: `${PREFIX}${randomUUID()}` })
      .returning({ id: conversations.id });
    await db.insert(conversation_participants).values([
      {
        conversation_id: viaAgency!.id,
        account_id: client.authId,
        participant_type: "CLIENT",
      },
      {
        conversation_id: viaAgency!.id,
        agency_id: agency!.id,
        participant_type: "AGENCY",
      },
    ]);

    const data = await getConversations(client.authId);
    const body = JSON.stringify(data);

    expect(data.conversations).toHaveLength(2);
    const keys = collectKeys(JSON.parse(body));
    for (const forbidden of ["email", "accountId", "agencyId"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(body).not.toContain(freelancer.email);
    expect(body).not.toContain(agencyOwner.email);
    expect(body).not.toContain(client.email);

    const participants = data.conversations.flatMap(
      (conversation) =>
        conversation.participants as Array<Record<string, unknown>>,
    );
    for (const participant of participants) {
      expect(Object.keys(participant).sort()).toEqual([
        "avatarUrl",
        "companyName",
        "name",
        "participantType",
        "professionalTitle",
      ]);
    }
    expect(participants).toContainEqual(
      expect.objectContaining({
        participantType: "AGENCY",
        name: "Agency Visible Name",
        avatarUrl: "https://img.example.test/a.png",
      }),
    );
    expect(participants).toContainEqual(
      expect.objectContaining({
        participantType: "CLIENT",
        name: "Acme Test Co",
        companyName: "Acme Test Co",
      }),
    );
    expect(participants).toContainEqual(
      expect.objectContaining({
        participantType: "FREELANCER",
        name: "Member",
        professionalTitle: "Staff Engineer",
      }),
    );
  });
});

describe("createConversation self-dealing", () => {
  it("rejects a conversation with yourself", async () => {
    const user = await createAccount("CLIENT");

    await expect(
      createConversation(user.authId, { recipientId: user.authId }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const data = await getConversations(user.authId);
    expect(data.conversations).toHaveLength(0);
  });
});
