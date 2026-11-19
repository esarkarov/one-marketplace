import { AsyncLocalStorage } from "node:async_hooks";

interface WebhookEventContext {
  eventId: string | undefined;
}

const storage = new AsyncLocalStorage<WebhookEventContext>();

export const runWithWebhookEvent = <T>(
  eventId: string | undefined,
  handler: () => Promise<T>,
): Promise<T> => storage.run({ eventId }, handler);

export const currentWebhookEventId = (): string | undefined =>
  storage.getStore()?.eventId;
