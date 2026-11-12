import type { Server as HttpServer } from "node:http";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Server } from "socket.io";
import { socketCorsOptions } from "../../config/cors.js";
import { db } from "../../database/client.js";
import { conversation_participants, messages } from "./messaging.schema.js";
import { authenticateAccount } from "../../shared/http/auth/auth.middleware.js";
import { ApiError } from "../../shared/http/api-error.js";
import { getAgencyIdForMember } from "../agency/agency.public.js";

type ConversationScope = "default" | "agency";

let io: Server | undefined;
const userSockets = new Map<string, Set<string>>();

// An agency conversation has one shared participant row tagged with the
// agency's id (not any one member's account id), so every current team
// member connecting with scope "agency" joins the *same* room, keyed by
// agencyId — presence and unread events reach the whole team, not just
// whichever member happens to be connected.
const scopeRoom = (id: string, scope: ConversationScope) =>
  `user:${id}:${scope}`;

const getConversationUsers = async (
  userId: string,
  scope: ConversationScope,
  agencyId: string | null,
) => {
  const memberships = await db
    .select({ conversationId: conversation_participants.conversation_id })
    .from(conversation_participants)
    .where(
      scope === "agency" && agencyId
        ? eq(conversation_participants.agency_id, agencyId)
        : eq(conversation_participants.account_id, userId),
    );
  const conversationIds = memberships.map(
    ({ conversationId }) => conversationId,
  );
  if (!conversationIds.length) return { conversationIds, participants: [] };
  const rows = await db
    .select({
      accountId: conversation_participants.account_id,
      agencyId: conversation_participants.agency_id,
      participantType: conversation_participants.participant_type,
    })
    .from(conversation_participants)
    .where(inArray(conversation_participants.conversation_id, conversationIds));

  // Each conversation partner listens in *their own* scope room, not mine —
  // a client is always "default", the agency side is always "agency",
  // regardless of which scope I connected with.
  const byRoom = new Map<string, Set<ConversationScope>>();
  rows.forEach((row) => {
    const isAgency = row.participantType === "AGENCY";
    const roomId = isAgency ? row.agencyId : row.accountId;
    if (!roomId) return;
    const isSelf = isAgency ? roomId === agencyId : roomId === userId;
    if (isSelf) return;
    const theirScope: ConversationScope = isAgency ? "agency" : "default";
    const scopes = byRoom.get(roomId) ?? new Set<ConversationScope>();
    scopes.add(theirScope);
    byRoom.set(roomId, scopes);
  });

  const participants = [...byRoom.entries()].flatMap(([id, scopes]) =>
    [...scopes].map((theirScope) => ({ userId: id, scope: theirScope })),
  );
  return { conversationIds, participants };
};

export const authenticateHandshake = async (auth: {
  token?: unknown;
  role?: unknown;
}) => {
  const account = await authenticateAccount(auth?.token, auth?.role);
  if (!account.accountExists) {
    throw new ApiError(403, "An account for this role is required.");
  }
  return account;
};

export const initializeMessagingSocket = (server: HttpServer) => {
  io = new Server(server, { cors: socketCorsOptions });
  io.use(async (socket, next) => {
    try {
      socket.data.auth = await authenticateHandshake(socket.handshake.auth);
      next();
    } catch (error) {
      next(new Error(error instanceof Error ? error.message : "Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.auth.userId as string;
    const scope: ConversationScope =
      socket.handshake.auth.scope === "agency" ? "agency" : "default";
    const agencyId =
      scope === "agency" ? await getAgencyIdForMember(userId) : null;
    const selfRoomId = agencyId ?? userId;
    const { conversationIds, participants } = await getConversationUsers(
      userId,
      scope,
      agencyId,
    );
    const partnerIds = [...new Set(participants.map((p) => p.userId))];
    socket.join(scopeRoom(selfRoomId, scope));
    conversationIds.forEach((id) => socket.join(`conversation:${id}`));

    const sockets = userSockets.get(selfRoomId) ?? new Set<string>();
    const cameOnline = sockets.size === 0;
    sockets.add(socket.id);
    userSockets.set(selfRoomId, sockets);
    socket.emit("presence:snapshot", {
      userIds: partnerIds.filter((id) => userSockets.has(id)),
    });
    if (cameOnline) {
      participants.forEach(({ userId: id, scope: theirScope }) =>
        io?.to(scopeRoom(id, theirScope)).emit("presence:update", {
          userId: selfRoomId,
          online: true,
        }),
      );
    }

    socket.on("typing:set", ({ conversationId, isTyping }) => {
      const room = `conversation:${conversationId}`;
      if (socket.rooms.has(room)) {
        socket.to(room).emit("typing:update", {
          conversationId,
          userId,
          isTyping: Boolean(isTyping),
        });
      }
    });

    socket.on(
      "conversation:read",
      async (
        {
          conversationId,
          messageId,
        }: { conversationId: string; messageId: string },
        acknowledge?: (result: { success: boolean }) => void,
      ) => {
        const isUuid = (value: string) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value,
          );
        if (!isUuid(conversationId) || !isUuid(messageId)) {
          acknowledge?.({ success: false });
          return;
        }

        const [participant] = await db
          .update(conversation_participants)
          .set({
            last_read_message_id: messageId,
            last_read_at: new Date(),
            unread_count: 0,
          })
          .where(
            and(
              eq(conversation_participants.conversation_id, conversationId),
              agencyId
                ? eq(conversation_participants.agency_id, agencyId)
                : eq(conversation_participants.account_id, userId),
              sql`EXISTS (
                SELECT 1 FROM ${messages}
                WHERE ${messages.id} = ${messageId}
                  AND ${messages.conversation_id} = ${conversationId}
              )`,
            ),
          )
          .returning({ id: conversation_participants.id });

        acknowledge?.({ success: Boolean(participant) });
      },
    );

    socket.on("disconnect", () => {
      const activeSockets = userSockets.get(selfRoomId);
      activeSockets?.delete(socket.id);
      if (activeSockets?.size) return;
      userSockets.delete(selfRoomId);
      participants.forEach(({ userId: id, scope: theirScope }) =>
        io?.to(scopeRoom(id, theirScope)).emit("presence:update", {
          userId: selfRoomId,
          online: false,
          lastActiveAt: new Date().toISOString(),
        }),
      );
    });
  });
};

export const closeMessagingSocket = async (): Promise<void> => {
  const server = io;
  io = undefined;
  await server?.close();
};

export const emitConversationUpdate = async (
  conversationId: string,
  excludedUserId?: string,
) => {
  if (!io) return;
  const participants = await db
    .select({
      accountId: conversation_participants.account_id,
      agencyId: conversation_participants.agency_id,
      participantType: conversation_participants.participant_type,
    })
    .from(conversation_participants)
    .where(eq(conversation_participants.conversation_id, conversationId));
  participants.forEach(({ accountId, agencyId, participantType }) => {
    const isAgency = participantType === "AGENCY";
    const roomId = isAgency ? agencyId : accountId;
    if (!roomId) return;
    const scope: ConversationScope = isAgency ? "agency" : "default";
    const room = scopeRoom(roomId, scope);
    io?.in(room).socketsJoin(`conversation:${conversationId}`);
    io?.to(room).emit("conversation:update", {
      conversationId,
      messagesChanged: true,
      senderId: excludedUserId ?? null,
    });
  });
};
