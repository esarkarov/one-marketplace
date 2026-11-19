import { db } from "@/database/client.js";
import { createDailyJoinUrl } from "@/infrastructure/video/daily.client.js";
import {
  findAccountDisplays,
  findAccountPublicIds,
} from "@/modules/auth/index.js";
import { requirePublicId } from "@/shared/ids/public-ids.js";

const DEFAULT_PARTICIPANT_NAME = "Participant";

export interface MeetingJoinSource {
  id: string;
  roomName: string;
  roomUrl: string;
  startedAt: Date;
}

export const createMeetingJoinUrls = async (
  viewerAuthId: string,
  sources: MeetingJoinSource[],
  operation: string,
  onTokenFailure?: (source: MeetingJoinSource, error: unknown) => Promise<void>,
): Promise<Map<string, string>> => {
  if (sources.length === 0) return new Map();

  const [publicIds, displays] = await Promise.all([
    findAccountPublicIds(db, [viewerAuthId]),
    findAccountDisplays([viewerAuthId]),
  ]);
  const userId = requirePublicId(
    publicIds.get(viewerAuthId),
    operation,
    sources[0]!.id,
  );
  const userName =
    displays.get(viewerAuthId)?.displayName ?? DEFAULT_PARTICIPANT_NAME;

  const urls = await Promise.all(
    sources.map(async (source) => {
      try {
        return await createDailyJoinUrl({
          roomName: source.roomName,
          roomUrl: source.roomUrl,
          startedAt: source.startedAt,
          userId,
          userName,
        });
      } catch (error) {
        if (!onTokenFailure) throw error;
        await onTokenFailure(source, error);
        return source.roomUrl;
      }
    }),
  );
  return new Map(sources.map((source, index) => [source.id, urls[index]!]));
};
