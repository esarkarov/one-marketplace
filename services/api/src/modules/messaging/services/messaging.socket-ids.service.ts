import type { DbExecutor } from "@/database/database.types.js";
import { findAccountPublicIds } from "@/modules/auth/index.js";
import {
  buildSocketPublicIds,
  type SocketPublicIds,
} from "@/modules/messaging/utils/messaging.socket-payloads.js";
import type { ConversationScope } from "@/modules/messaging/types/messaging.types.js";

export const loadSocketPublicIds = async (
  executor: DbExecutor,
  input: {
    userId: string;
    participants: { userId: string; scope: ConversationScope }[];
    agencyId: string | null;
  },
): Promise<SocketPublicIds> => {
  const personIds = input.participants
    .filter(({ scope }) => scope === "default")
    .map(({ userId }) => userId);
  const agencyIds = input.participants
    .filter(({ scope }) => scope === "agency")
    .map(({ userId }) => userId);
  if (input.agencyId) agencyIds.push(input.agencyId);
  const publicIds = await findAccountPublicIds(executor, [
    input.userId,
    ...personIds,
  ]);
  return buildSocketPublicIds({
    agencyIds: [...new Set(agencyIds)],
    rows: [...publicIds].map(([authId, id]) => ({ authId, id })),
  });
};
