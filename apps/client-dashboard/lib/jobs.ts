import type {
  ApiFieldError,
  Components,
  Paths,
} from "@onemarketplace/api-client";
import {
  centsToFormAmount,
  toCents,
  validateMoneyInput,
  type MoneyBounds,
} from "@onemarketplace/web-core";
import {
  centsToDollarsString,
  dollarsToCents,
  errorMessage,
  formatCents,
  isApiError,
} from "@onemarketplace/api-client";

export type JobPost = Components["schemas"]["JobsPostWithStats"];
export type JobStatus = JobPost["status"];
export type JobAttachment = NonNullable<JobPost["attachments"]>[number];
export type JobBody =
  Paths["/api/v1/jobs"]["post"]["requestBody"]["content"]["application/json"];
export type JobBodyAttachment = NonNullable<JobBody["attachments"]>[number];
export type JobSaveStatus = "DRAFT" | "PUBLISHED";

export const JOB_NOT_FOUND_CODE = "JOB_NOT_FOUND";
export const JOB_PAGE_SIZE = 10;

export const JOB_LIMITS = {
  title: 100,
  titleMin: 10,
  description: 5000,
  descriptionMin: 80,
  milestoneTitle: 120,
  milestoneTitleMin: 3,
  maxAttachments: 3,
  maxAttachmentBytes: 5 * 1024 * 1024,
} as const;

export const JOB_MILESTONE_MIN_CENTS = 501;
export const JOB_MILESTONE_MAX_CENTS = 100_000_000;

const formatGroupedInteger = (value: number): string =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const JOB_MESSAGES = {
  titleMin: `Job title must be at least ${JOB_LIMITS.titleMin} characters.`,
  titleMax: `Job title cannot exceed ${JOB_LIMITS.title} characters.`,
  descriptionMin: `Add at least ${JOB_LIMITS.descriptionMin} characters so talent can scope the work.`,
  descriptionMax: `Description cannot exceed ${formatGroupedInteger(JOB_LIMITS.description)} characters.`,
  milestoneTitleMin: `Use at least ${JOB_LIMITS.milestoneTitleMin} characters.`,
  attachmentCount: `Add no more than ${JOB_LIMITS.maxAttachments} attachments.`,
  attachmentSize: `Attachments cannot exceed ${JOB_LIMITS.maxAttachmentBytes / (1024 * 1024)} MB in total.`,
} as const;

export const JOB_MILESTONE_MIN_INPUT = centsToDollarsString(
  JOB_MILESTONE_MIN_CENTS,
);

const KNOWN_STATUS_LABELS = {
  DRAFT: "Draft",
  PUBLISHED: "Open",
  HIRED: "Hired",
} satisfies Record<JobStatus, string>;

const STATUS_LABELS: Readonly<Record<string, string>> = KNOWN_STATUS_LABELS;

export const jobStatusLabel = (status: string): string =>
  Object.hasOwn(STATUS_LABELS, status)
    ? (STATUS_LABELS[status] ?? status)
    : status;

export const isJobOpen = (status: string): boolean => status === "PUBLISHED";

export const isJobLocked = (status: string): boolean => status === "HIRED";

export interface JobMilestoneValues {
  title: string;
  amount: number;
  due: string;
}

export interface JobFormValues {
  title: string;
  description: string;
  expertise: string;
  duration: string;
  skills: string;
  milestones: JobMilestoneValues[];
  questions: { value: string }[];
}

export interface InitialJobPost {
  id: string;
  title: string;
  description: string;
  level: string;
  duration: string;
  skills: string[];
  screeningQuestions: string[];
  milestones: JobMilestoneValues[];
  attachments: JobAttachment[];
}

export type JobFormFieldName =
  | "title"
  | "description"
  | "expertise"
  | "duration"
  | "skills"
  | "attachments"
  | `milestones.${number}.title`
  | `milestones.${number}.amount`
  | `milestones.${number}.due`
  | `questions.${number}.value`;

export interface JobFieldError {
  name: JobFormFieldName;
  message: string;
}

export const parseSkills = (value: string): string[] =>
  value
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);

export const validateMilestoneAmount = (
  amount: number | string,
  bounds: MoneyBounds = {
    minCents: JOB_MILESTONE_MIN_CENTS,
    maxCents: JOB_MILESTONE_MAX_CENTS,
  },
): string | null => validateMoneyInput(amount, bounds);

export const totalBudgetCents = (
  milestones: readonly { amount: number | string }[],
): number =>
  milestones.reduce((total, milestone) => {
    const cents = toCents(milestone.amount);
    return cents === null ? total : total + cents;
  }, 0);

export const formatTotalBudget = (
  milestones: readonly { amount: number | string }[],
): string => formatCents(totalBudgetCents(milestones));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})T/;
const TEXT_DATE_WITH_YEAR = /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/;

const pad = (value: number): string => String(value).padStart(2, "0");

export const normalizeDueDate = (dueDate: string): string => {
  const value = dueDate.trim();
  if (ISO_DATE.test(value)) return value;
  const prefixed = ISO_DATE_PREFIX.exec(value);
  if (prefixed?.[1]) return prefixed[1];
  if (!TEXT_DATE_WITH_YEAR.test(value)) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
};

export const jobToInitial = (job: JobPost): InitialJobPost => ({
  id: job.id,
  title: job.title,
  description: job.description,
  level: job.expertiseLevel,
  duration: job.expectedDuration,
  skills: job.skills,
  screeningQuestions: job.screeningQuestions ?? [],
  milestones: job.milestones.map((milestone) => ({
    title: milestone.title,
    amount: centsToFormAmount(milestone.budgetCents),
    due: normalizeDueDate(milestone.dueDate),
  })),
  attachments: job.attachments ?? [],
});

export const toJobBody = (
  values: JobFormValues,
  status: JobSaveStatus,
  attachments: JobBodyAttachment[],
): JobBody => ({
  title: values.title.trim(),
  description: values.description.trim(),
  expertiseLevel: values.expertise,
  expectedDuration: values.duration,
  skills: parseSkills(values.skills),
  milestones: values.milestones.map((milestone) => ({
    title: milestone.title.trim(),
    budgetCents: dollarsToCents(milestone.amount),
    dueDate: milestone.due,
  })),
  screeningQuestions: values.questions
    .map(({ value }) => value.trim())
    .filter(Boolean),
  attachments,
  status,
});

const SIMPLE_FIELDS: Readonly<Record<string, JobFormFieldName>> = {
  title: "title",
  description: "description",
  expertiseLevel: "expertise",
  expectedDuration: "duration",
  skills: "skills",
  attachments: "attachments",
};

const MILESTONE_PATH = /^milestones\.(\d+)\.(title|budgetCents|dueDate)$/;
const QUESTION_PATH = /^screeningQuestions\.(\d+)$/;
const ROOT_PATH = /^(title|description|expertiseLevel|expectedDuration)$/;
const LIST_PATH = /^(skills|attachments)(\.\d+)?(\..+)?$/;

const stripBody = (path: string): string =>
  path.startsWith("body.") ? path.slice("body.".length) : path;

export const jobFieldName = (path: string): JobFormFieldName | null => {
  const clean = stripBody(path);
  const milestone = MILESTONE_PATH.exec(clean);
  if (milestone) {
    const index = Number(milestone[1]);
    if (milestone[2] === "title") return `milestones.${index}.title`;
    if (milestone[2] === "budgetCents") return `milestones.${index}.amount`;
    return `milestones.${index}.due`;
  }
  const question = QUESTION_PATH.exec(clean);
  if (question) return `questions.${Number(question[1])}.value`;
  if (ROOT_PATH.test(clean)) return SIMPLE_FIELDS[clean] ?? null;
  const list = LIST_PATH.exec(clean);
  if (list?.[1]) return SIMPLE_FIELDS[list[1]] ?? null;
  return null;
};

export const jobFieldErrorsFromApi = (
  errors: readonly ApiFieldError[] | undefined,
): JobFieldError[] => {
  const seen = new Set<string>();
  const result: JobFieldError[] = [];
  for (const item of errors ?? []) {
    const name = jobFieldName(item.path);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({ name, message: item.message });
  }
  return result;
};

export const hasUnmappedErrors = (
  errors: readonly ApiFieldError[] | undefined,
): boolean => (errors ?? []).some((item) => jobFieldName(item.path) === null);

export const isJobNotFound = (error: unknown): boolean =>
  isApiError(error) && error.code === JOB_NOT_FOUND_CODE;

export const jobErrorMessage = (error: unknown): string => {
  const message = errorMessage(error);
  return isApiError(error) && error.requestId
    ? `${message} (reference ${error.requestId})`
    : message;
};
