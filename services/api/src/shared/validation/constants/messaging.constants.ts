export const MESSAGING_LIMITS = {
  body: 10_000,
  recipientId: 64,
  cursor: 512,
  attachmentMimeType: 127,
} as const;

export const MESSAGES_PAGE = { defaultLimit: 30, maxLimit: 50 } as const;
