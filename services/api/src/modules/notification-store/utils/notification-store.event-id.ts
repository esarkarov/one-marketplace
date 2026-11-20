import { uuidV5 } from "@/shared/ids/uuid-v5.js";

const SEPARATOR = ":";

const requirePart = (name: string, value: string): string => {
  if (!value || value.includes(SEPARATOR)) {
    throw new Error(
      `Notification event id ${name} must be non-empty and contain no "${SEPARATOR}".`,
    );
  }
  return value;
};

export const notificationEventId = (
  kind: string,
  entityId: string,
  transition: string,
): string =>
  uuidV5(
    [
      requirePart("kind", kind),
      requirePart("entityId", entityId),
      requirePart("transition", transition),
    ].join(SEPARATOR),
  );
