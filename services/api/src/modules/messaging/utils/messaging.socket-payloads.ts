import { requirePublicId } from "../../../shared/ids/public-ids.js";

export type SocketPublicIds = ReadonlyMap<string, string>;

interface PublicIdRow {
  authId: string;
  id: string;
}

export const buildSocketPublicIds = (input: {
  agencyIds: string[];
  rows: PublicIdRow[];
}): SocketPublicIds => {
  const map = new Map<string, string>();
  input.rows.forEach(({ authId, id }) => map.set(authId, id));
  input.agencyIds.forEach((agencyId) => map.set(agencyId, agencyId));
  return map;
};

const publicId = (ids: SocketPublicIds, roomId: string, operation: string) =>
  requirePublicId(ids.get(roomId), operation, roomId);

export const toPresenceSnapshotPayload = (
  ids: SocketPublicIds,
  onlineRoomIds: string[],
) => ({
  userIds: onlineRoomIds.map((roomId) =>
    publicId(ids, roomId, "socket_presence_snapshot"),
  ),
});

export const toPresenceOnlinePayload = (
  ids: SocketPublicIds,
  roomId: string,
) => ({
  userId: publicId(ids, roomId, "socket_presence_update"),
  online: true,
});

export const toPresenceOfflinePayload = (
  ids: SocketPublicIds,
  roomId: string,
  lastActiveAt: Date,
) => ({
  userId: publicId(ids, roomId, "socket_presence_update"),
  online: false,
  lastActiveAt: lastActiveAt.toISOString(),
});

export const toTypingUpdatePayload = (
  ids: SocketPublicIds,
  input: { conversationId: string; userId: string; isTyping: unknown },
) => ({
  conversationId: input.conversationId,
  userId: publicId(ids, input.userId, "socket_typing_update"),
  isTyping: Boolean(input.isTyping),
});

export const toConversationUpdatePayload = (
  conversationId: string,
  senderAccountId: string | null,
) => ({
  conversationId,
  messagesChanged: true,
  senderId: senderAccountId,
});
