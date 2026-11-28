export class OutboxPayloadError extends Error {
  readonly notificationType: string;

  constructor(notificationType: string) {
    super(`Outbox payload for ${notificationType} is invalid.`);
    this.name = "OutboxPayloadError";
    this.notificationType = notificationType;
  }
}
