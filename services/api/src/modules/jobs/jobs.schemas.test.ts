import { describe, expect, it } from "vitest";
import {
  emptyQuerySchema,
  jobBodySchema,
  jobIdParamsSchema,
  publicJobFeedQuerySchema,
} from "./jobs.schemas.js";

const message = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => result.error?.issues[0]?.message;

describe("jobBodySchema", () => {
  it("keeps allowlisted fields and strips unknown keys", () => {
    const result = jobBodySchema.parse({
      role: "client",
      client_id: "x",
      title: "T",
      description: "D",
      expertise_level: "Expert",
      expected_duration: "1 month",
      status: "DRAFT",
      skills: ["a", 2],
      screening_questions: ["q"],
      milestones: [
        { id: "m", title: "M", budget: 10, dueDate: "2030-01-01", extra: 1 },
      ],
      attachments: [
        {
          fileId: "f",
          fileName: "n",
          fileUrl: "u",
          fileType: "text/plain",
          fileSize: 3,
          extra: 1,
        },
      ],
      isAdmin: true,
    });

    expect(Object.keys(result).sort()).toEqual(
      [
        "title",
        "description",
        "expertise_level",
        "expected_duration",
        "status",
        "skills",
        "screening_questions",
        "milestones",
        "attachments",
      ].sort(),
    );
    expect(result.milestones?.[0]).toEqual({
      id: "m",
      title: "M",
      budget: 10,
      dueDate: "2030-01-01",
    });
    expect(result.attachments?.[0]).not.toHaveProperty("extra");
  });

  it("rejects non-object bodies", () => {
    for (const value of [undefined, null, "x", 5, []]) {
      const result = jobBodySchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(message(result)).toBe("Request body must be an object.");
    }
  });

  it.each([
    [{ skills: "a" }, "Skills must be an array."],
    [{ screening_questions: {} }, "Screening questions must be an array."],
    [{ milestones: "x" }, "Milestones must be an array."],
    [{ attachments: 1 }, "Attachments must be an array."],
    [{ milestones: [null] }, "Each milestone must be an object."],
    [{ attachments: ["x"] }, "Each attachment must be an object."],
  ])("rejects bad structure %j", (body, expected) => {
    const result = jobBodySchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(message(result)).toBe(expected);
  });

  it("lets conditions the controller answers pass through", () => {
    const result = jobBodySchema.safeParse({
      title: 5,
      description: null,
      skills: null,
      milestones: [{ title: 1, budget: "abc", dueDate: {} }],
      attachments: [{ fileType: 1 }],
    });

    expect(result.success).toBe(true);
    expect(result.data?.title).toBeUndefined();
    expect(result.data?.milestones?.[0]).toEqual({
      id: undefined,
      title: undefined,
      budget: "abc",
      dueDate: undefined,
    });
  });

  it("accepts an empty object so the controller reports missing fields", () => {
    expect(jobBodySchema.safeParse({}).success).toBe(true);
  });
});

describe("jobIdParamsSchema", () => {
  it("accepts a uuid and strips extra keys", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(jobIdParamsSchema.parse({ jobId: id, other: "x" })).toEqual({
      jobId: id,
    });
  });

  it("rejects a malformed id", () => {
    const result = jobIdParamsSchema.safeParse({ jobId: "nope" });
    expect(message(result)).toBe("Job post id is invalid.");
  });
});

describe("publicJobFeedQuerySchema", () => {
  it("keeps only the keys the controller reads", () => {
    expect(
      publicJobFeedQuerySchema.parse({
        query: "a",
        sort: "budget",
        offset: "5",
        levels: "x,y",
        paymentVerified: "true",
        minBudget: "1",
        maxBudget: "9",
        maxProposals: "3",
        role: "client",
        other: "z",
      }),
    ).toEqual({
      query: "a",
      sort: "budget",
      offset: "5",
      levels: "x,y",
      paymentVerified: "true",
      minBudget: "1",
      maxBudget: "9",
      maxProposals: "3",
    });
  });

  it("ignores non-string values like the controller does", () => {
    const result = publicJobFeedQuerySchema.parse({
      sort: ["x"],
      query: { a: "b" },
    });
    expect(result.sort).toBeUndefined();
    expect(result.query).toBeUndefined();
  });
});

describe("emptyQuerySchema", () => {
  it("strips every key", () => {
    expect(emptyQuerySchema.parse({ role: "client", a: "b" })).toEqual({});
  });
});
