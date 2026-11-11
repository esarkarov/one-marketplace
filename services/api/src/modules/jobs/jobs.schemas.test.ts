import { describe, expect, it } from "vitest";
import {
  jobBodySchema,
  jobIdParamsSchema,
  publicJobFeedQuerySchema,
} from "./jobs.schemas.js";

const message = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => result.error?.issues[0]?.message;

describe("jobBodySchema", () => {
  it("keeps allowlisted fields and strips only the ignored keys", () => {
    const result = jobBodySchema.parse({
      id: "x",
      imageId: "y",
      createdAt: "z",
      updatedAt: "w",
      role: "client",
      title: "T",
      description: "D",
      expertise_level: "Expert",
      expected_duration: "1 month",
      status: "DRAFT",
      skills: ["a", "b"],
      screening_questions: ["q"],
      milestones: [
        {
          id: "m",
          title: "M",
          budgetCents: 1000,
          dueDate: "2030-01-01",
        },
      ],
      attachments: [
        {
          fileId: "f",
          fileName: "n",
          fileUrl: "u",
          fileType: "text/plain",
          fileSize: 3,
        },
      ],
    });

    expect(Object.keys(result).sort()).toEqual(
      [
        "role",
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
  });

  it.each([
    [{ client_id: "x" }],
    [{ isAdmin: true }],
    [{ milestones: [{ budgetCents: 1000, extra: 1 }] }],
    [{ attachments: [{ fileName: "a", extra: 1 }] }],
  ])("rejects unknown keys in %j", (body) => {
    expect(jobBodySchema.safeParse(body).success).toBe(false);
  });

  it("rejects non-object bodies", () => {
    for (const value of [undefined, null, "x", 5, []]) {
      expect(jobBodySchema.safeParse(value).success).toBe(false);
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

  it.each([
    [{ title: 5 }],
    [{ description: null }],
    [{ skills: ["a", 2] }],
    [{ milestones: [{ title: 1, budgetCents: 1000 }] }],
    [{ attachments: [{ fileSize: "3" }] }],
  ])("rejects wrong types in %j", (body) => {
    expect(jobBodySchema.safeParse(body).success).toBe(false);
  });

  it("accepts a long document mime type", () => {
    const fileType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(
      jobBodySchema.safeParse({
        attachments: [{ fileName: "a.docx", fileType }],
      }).success,
    ).toBe(true);
  });

  it("rejects too many attachments with the controller message", () => {
    const result = jobBodySchema.safeParse({
      attachments: Array.from({ length: 6 }, () => ({ fileName: "a.pdf" })),
    });
    expect(message(result)).toBe("A job post can have up to 5 attachments.");
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
  it("accepts a uuid", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(jobIdParamsSchema.parse({ jobId: id })).toEqual({ jobId: id });
  });

  it("rejects a malformed id and unknown params", () => {
    const result = jobIdParamsSchema.safeParse({ jobId: "nope" });
    expect(message(result)).toBe("Job post id is invalid.");
    expect(
      jobIdParamsSchema.safeParse({
        jobId: "123e4567-e89b-42d3-a456-426614174000",
        other: "x",
      }).success,
    ).toBe(false);
  });
});

describe("publicJobFeedQuerySchema", () => {
  it("parses the keys the controller reads", () => {
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

  it.each([
    [{ other: "z" }],
    [{ role: "client" }],
    [{ sort: ["x"] }],
    [{ query: { a: "b" } }],
    [{ offset: "abc" }],
    [{ maxProposals: "-1" }],
    [{ paymentVerified: "yes" }],
  ])("rejects %j", (query) => {
    expect(publicJobFeedQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("jobBodySchema previously accepted nulls", () => {
  it("accepts a numeric or null milestone id", () => {
    for (const id of [7, null, "abc"]) {
      const result = jobBodySchema.safeParse({
        milestones: [{ id, budgetCents: 1000 }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects a boolean milestone id", () => {
    expect(
      jobBodySchema.safeParse({
        milestones: [{ id: true, budgetCents: 1000 }],
      }).success,
    ).toBe(false);
  });

  it("accepts null attachments, screening questions, status and attachment extras", () => {
    expect(
      jobBodySchema.safeParse({
        attachments: null,
        screening_questions: null,
        skills: null,
        status: null,
      }).success,
    ).toBe(true);
    expect(
      jobBodySchema.safeParse({
        attachments: [{ fileId: null, fileSize: null }],
      }).success,
    ).toBe(true);
  });
});
