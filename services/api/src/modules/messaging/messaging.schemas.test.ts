import { describe, expect, it } from "vitest";

import {
  createMessageBodySchema,
  openConversationBodySchema,
} from "./messaging.schemas.js";

describe("createMessageBodySchema", () => {
  it("accepts null body and attachments", () => {
    expect(
      createMessageBodySchema.safeParse({ body: null, attachments: null })
        .success,
    ).toBe(true);
  });
});

describe("openConversationBodySchema", () => {
  it("uses the field label when a reference is not a uuid", () => {
    const result = openConversationBodySchema.safeParse({ jobId: "nope" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Job post is invalid.");
  });
});
