import { ApiError } from "@onemarketplace/api-client";
import { centsToFormAmount, toCents } from "@onemarketplace/web-core";
import { describe, expect, it } from "vitest";
import {
  formatTotalBudget,
  hasUnmappedErrors,
  isJobLocked,
  isJobNotFound,
  isJobOpen,
  jobErrorMessage,
  jobFieldErrorsFromApi,
  jobFieldName,
  jobStatusLabel,
  jobToInitial,
  normalizeDueDate,
  parseSkills,
  toJobBody,
  totalBudgetCents,
  validateMilestoneAmount,
  JOB_LIMITS,
  JOB_MESSAGES,
  JOB_MILESTONE_MAX_CENTS,
  JOB_MILESTONE_MIN_CENTS,
  JOB_MILESTONE_MIN_INPUT,
  type JobFormValues,
  type JobPost,
} from "./jobs";

const values: JobFormValues = {
  title: "  Build a workspace  ",
  description: " Details ",
  expertise: "Expert",
  duration: "1–2 months",
  skills: " Next.js, , TypeScript ",
  milestones: [
    { title: " Prototype ", amount: 19.99, due: "2027-01-10" },
    { title: "Launch", amount: 1000, due: "2027-02-10" },
  ],
  questions: [{ value: " Why? " }, { value: "  " }],
};

const job: JobPost = {
  id: "9b2f0c2e-7a3a-4a37-9b7a-0b6d3a1f2c11",
  clientId: "c0a8f3b1-1d6e-4c52-8a1f-9d3e2b7a4c10",
  title: "Build a workspace",
  description: "Details",
  expertiseLevel: "Expert",
  expectedDuration: "1–2 months",
  skills: ["Next.js"],
  status: "PUBLISHED",
  attachments: null,
  screeningQuestions: null,
  milestones: [
    { id: "m1", title: "Prototype", budgetCents: 1999, dueDate: "Dec 5" },
  ],
  totalBudgetCents: 1999,
  proposalCount: 1,
  shortlistCount: 0,
  hireCount: 0,
  hiredAt: null,
  publishedAt: null,
  createdAt: null,
  updatedAt: null,
};

describe("status", () => {
  it("labels every enum value explicitly", () => {
    expect(jobStatusLabel("DRAFT")).toBe("Draft");
    expect(jobStatusLabel("PUBLISHED")).toBe("Open");
    expect(jobStatusLabel("HIRED")).toBe("Hired");
  });

  it("shows unknown values as they are", () => {
    expect(jobStatusLabel("ARCHIVED")).toBe("ARCHIVED");
    expect(jobStatusLabel("toString")).toBe("toString");
    expect(jobStatusLabel("")).toBe("");
  });

  it("derives open and locked flags", () => {
    expect(isJobOpen("PUBLISHED")).toBe(true);
    expect(isJobOpen("DRAFT")).toBe(false);
    expect(isJobLocked("HIRED")).toBe(true);
    expect(isJobLocked("PUBLISHED")).toBe(false);
  });
});

describe("money", () => {
  it("converts dollars to cents without float math", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents("12.5")).toBe(1250);
    expect(toCents(0.1 + 0.2)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(-5)).toBeNull();
  });

  it("matches the backend job milestone bounds of 501 cents to $1,000,000", () => {
    expect(JOB_MILESTONE_MIN_CENTS).toBe(501);
    expect(JOB_MILESTONE_MAX_CENTS).toBe(100_000_000);
    expect(validateMilestoneAmount(5.01)).toBeNull();
    expect(validateMilestoneAmount(10)).toBeNull();
    expect(validateMilestoneAmount(5)).toBe("Budget must be at least $5.01.");
    expect(validateMilestoneAmount(0)).toBe("Budget must be at least $5.01.");
    expect(validateMilestoneAmount(Number.NaN)).toBe("Enter a valid number.");
    expect(validateMilestoneAmount(10.123)).toBe(
      "Use a plain amount with at most 2 decimals.",
    );
    expect(validateMilestoneAmount(1_000_000.01)).toBe(
      "Budget cannot exceed $1,000,000.00.",
    );
  });

  it("totals in cents and skips invalid amounts", () => {
    expect(totalBudgetCents(values.milestones)).toBe(101999);
    expect(totalBudgetCents([{ amount: Number.NaN }, { amount: 10 }])).toBe(
      1000,
    );
    expect(formatTotalBudget(values.milestones)).toBe("$1,019.99");
    expect(formatTotalBudget([])).toBe("$0.00");
  });

  it("round trips cents through the form amount", () => {
    for (const cents of [1000, 1999, 1250, 100_000_000, 1001]) {
      expect(toCents(centsToFormAmount(cents))).toBe(cents);
    }
  });
});

describe("due dates", () => {
  it("keeps ISO dates and trims timestamps", () => {
    expect(normalizeDueDate("2027-03-04")).toBe("2027-03-04");
    expect(normalizeDueDate("2027-03-04T10:00:00.000Z")).toBe("2027-03-04");
  });

  it("parses legacy text only when it carries a year", () => {
    expect(normalizeDueDate("Dec 5, 2027")).toBe("2027-12-05");
  });

  it("returns empty instead of guessing a year", () => {
    expect(normalizeDueDate("Dec 5")).toBe("");
    expect(normalizeDueDate("")).toBe("");
    expect(normalizeDueDate("not a date 2027")).toBe("");
  });
});

describe("mapping", () => {
  it("parses skills", () => {
    expect(parseSkills(" Next.js, , TypeScript ")).toEqual([
      "Next.js",
      "TypeScript",
    ]);
    expect(parseSkills("")).toEqual([]);
  });

  it("builds the camelCase body in cents", () => {
    const attachments = [{ fileId: null, fileName: "a.pdf" }];
    expect(toJobBody(values, "DRAFT", attachments)).toEqual({
      title: "Build a workspace",
      description: "Details",
      expertiseLevel: "Expert",
      expectedDuration: "1–2 months",
      skills: ["Next.js", "TypeScript"],
      milestones: [
        { title: "Prototype", budgetCents: 1999, dueDate: "2027-01-10" },
        { title: "Launch", budgetCents: 100000, dueDate: "2027-02-10" },
      ],
      screeningQuestions: ["Why?"],
      attachments,
      status: "DRAFT",
    });
  });

  it("maps a job to the form shape", () => {
    expect(jobToInitial(job)).toEqual({
      id: job.id,
      title: "Build a workspace",
      description: "Details",
      level: "Expert",
      duration: "1–2 months",
      skills: ["Next.js"],
      screeningQuestions: [],
      milestones: [{ title: "Prototype", amount: 19.99, due: "" }],
      attachments: [],
    });
  });
});

describe("api errors", () => {
  it("maps api paths to form fields", () => {
    expect(jobFieldName("title")).toBe("title");
    expect(jobFieldName("body.description")).toBe("description");
    expect(jobFieldName("expertiseLevel")).toBe("expertise");
    expect(jobFieldName("expectedDuration")).toBe("duration");
    expect(jobFieldName("skills")).toBe("skills");
    expect(jobFieldName("skills.2")).toBe("skills");
    expect(jobFieldName("attachments.0.fileUrl")).toBe("attachments");
    expect(jobFieldName("milestones.1.budgetCents")).toBe(
      "milestones.1.amount",
    );
    expect(jobFieldName("milestones.0.title")).toBe("milestones.0.title");
    expect(jobFieldName("milestones.2.dueDate")).toBe("milestones.2.due");
    expect(jobFieldName("screeningQuestions.3")).toBe("questions.3.value");
    expect(jobFieldName("status")).toBeNull();
    expect(jobFieldName("")).toBeNull();
  });

  it("keeps the first message per field and reports unmapped ones", () => {
    const errors = [
      { path: "title", message: "Too long" },
      { path: "title", message: "Other" },
      { path: "milestones.0.budgetCents", message: "Bad budget" },
      { path: "status", message: "Bad status" },
    ];
    expect(jobFieldErrorsFromApi(errors)).toEqual([
      { name: "title", message: "Too long" },
      { name: "milestones.0.amount", message: "Bad budget" },
    ]);
    expect(hasUnmappedErrors(errors)).toBe(true);
    expect(hasUnmappedErrors(errors.slice(0, 3))).toBe(false);
    expect(jobFieldErrorsFromApi(undefined)).toEqual([]);
    expect(hasUnmappedErrors(undefined)).toBe(false);
  });

  it("detects a missing job and adds the reference id", () => {
    const missing = new ApiError({
      status: 404,
      code: "JOB_NOT_FOUND",
      message: "Job post not found.",
      requestId: "req-1",
    });
    expect(isJobNotFound(missing)).toBe(true);
    expect(isJobNotFound(new Error("x"))).toBe(false);
    expect(jobErrorMessage(missing)).toBe(
      "Job post not found. (reference req-1)",
    );
    expect(jobErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("generated copy", () => {
  it("derives the form messages from the limits", () => {
    expect(JOB_MESSAGES.titleMin).toBe(
      `Job title must be at least ${JOB_LIMITS.titleMin} characters.`,
    );
    expect(JOB_MESSAGES.titleMax).toBe(
      `Job title cannot exceed ${JOB_LIMITS.title} characters.`,
    );
    expect(JOB_MESSAGES.descriptionMin).toContain(
      String(JOB_LIMITS.descriptionMin),
    );
    expect(JOB_MESSAGES.descriptionMax).toBe(
      "Description cannot exceed 5,000 characters.",
    );
    expect(JOB_MESSAGES.milestoneTitleMin).toBe("Use at least 3 characters.");
    expect(JOB_MESSAGES.attachmentCount).toBe(
      "Add no more than 3 attachments.",
    );
    expect(JOB_MESSAGES.attachmentSize).toBe(
      "Attachments cannot exceed 5 MB in total.",
    );
  });

  it("derives the budget input minimum from the cent floor", () => {
    expect(JOB_MILESTONE_MIN_INPUT).toBe("5.01");
  });

  it("derives the budget messages from the cent bounds", () => {
    expect(validateMilestoneAmount(5)).toBe(
      `Budget must be at least $${JOB_MILESTONE_MIN_INPUT}.`,
    );
    expect(validateMilestoneAmount(1_000_000.01)).toBe(
      "Budget cannot exceed $1,000,000.00.",
    );
  });
});
