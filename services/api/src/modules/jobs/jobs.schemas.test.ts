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
        {
          id: "m",
          title: "M",
          budgetCents: 1000,
          dueDate: "2030-01-01",
          extra: 1,
        },
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
      budgetCents: 1000,
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
      milestones: [{ title: 1, budgetCents: 1000, dueDate: {} }],
      attachments: [{ fileType: 1 }],
    });

    expect(result.success).toBe(true);
    expect(result.data?.title).toBeUndefined();
    expect(result.data?.milestones?.[0]).toEqual({
      id: undefined,
      title: undefined,
      budgetCents: 1000,
      dueDate: undefined,
    });
  });

  it.each([
    ["fractional", 1000.5],
    ["negative", -1000],
    ["too small", 500],
    ["above the limit", 100_000_001],
    ["a string", "1000"],
    ["missing", undefined],
  ])("rejects a %s milestone budgetCents", (_name, budgetCents) => {
    const result = jobBodySchema.safeParse({
      milestones: [{ title: "M", budgetCents, dueDate: "2030-01-01" }],
    });
    expect(result.success).toBe(false);
    expect(message(result)).toBe("Every milestone needs a valid budget.");
  });

  it("accepts the milestone budget limits", () => {
    for (const budgetCents of [501, 100_000_000]) {
      expect(
        jobBodySchema.safeParse({
          milestones: [{ title: "M", budgetCents, dueDate: "2030-01-01" }],
        }).success,
      ).toBe(true);
    }
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
        minBudgetCents: "100",
        maxBudgetCents: "900",
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
      minBudgetCents: 100,
      maxBudgetCents: 900,
      maxProposals: "3",
    });
  });

  it.each(["1.5", "-1", "abc", "9007199254740993"])(
    "rejects budget filter %s",
    (value) => {
      expect(
        publicJobFeedQuerySchema.safeParse({ minBudgetCents: value }).success,
      ).toBe(false);
      expect(
        publicJobFeedQuerySchema.safeParse({ maxBudgetCents: value }).success,
      ).toBe(false);
    },
  );

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
