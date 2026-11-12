// Existing values: attachments, search, live URL, email, admin redis pattern/key, message body, interview message, milestone requirements/title, review comment/rating, freelancer skills/languages. Every other value is new in stage 9a and provisional.
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS,
  MAX_DATA_URL_HEADER_LENGTH,
  MAX_ENCODED_LENGTH,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "../utils/attachments.js";
import { MAX_LIVE_URL_LENGTH } from "../utils/portfolio-images.js";
import {
  SEARCH_OFFSET_MAX,
  SEARCH_QUERY_MAX_LENGTH,
} from "./search-schemas.js";

export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS,
  MAX_DATA_URL_HEADER_LENGTH,
  MAX_ENCODED_LENGTH,
  MAX_LIVE_URL_LENGTH,
  MAX_TOTAL_ATTACHMENT_BYTES,
  SEARCH_OFFSET_MAX,
  SEARCH_QUERY_MAX_LENGTH,
};

export const COMMON_LIMITS = {
  email: 254,
  pagingDigits: 10,
  scope: 32,
  attachmentFileId: 255,
} as const;

export const ADMIN_LIMITS = {
  redisPattern: 64,
  redisKey: 128,
  password: 1024,
  streamToken: 2048,
} as const;

export const MESSAGING_LIMITS = {
  body: 10_000,
  recipientId: 64,
  cursor: 512,
  attachmentMimeType: 127,
} as const;

export const JOB_LIMITS = {
  titleMax: 100,
  descriptionMax: 5000,
  skillsMaxItems: 30,
  skillMaxLength: 50,
  screeningQuestionsMaxItems: 10,
  screeningQuestionMaxLength: 500,
  milestonesMaxItems: 20,
  milestoneTitleMax: 120,
  milestoneDueDateMax: 32,
  milestoneIdMax: 64,
  feedLevelsMax: 256,
  expertiseLevelMax: 50,
  expectedDurationMax: 50,
  statusMax: 50,
} as const;

export const PROPOSAL_LIMITS = {
  coverLetterMin: 80,
  coverLetterMax: 10_000,
  screeningAnswersMaxItems: 10,
  screeningAnswerMaxLength: 5000,
  durationMax: 50,
  interviewMessageMax: 5000,
} as const;

export const CONTRACT_LIMITS = {
  milestoneRequirementsMax: 500,
  milestoneTitleMin: 3,
  milestoneTitleMax: 120,
  reviewCommentMin: 10,
  reviewCommentMax: 1000,
  ratingMin: 1,
  ratingMax: 5,
  submissionMessageMin: 10,
  submissionMessageMax: 5000,
  feedbackMax: 5000,
  submissionDeliveryLinkMax: 2048,
} as const;

export const FREELANCER_LIMITS = {
  skillsMinItems: 3,
  skillsMaxItems: 15,
  skillMaxLength: 20,
  languagesMinItems: 1,
  languagesMaxItems: 5,
  professionalTitleMax: 100,
  professionalDescriptionMax: 5000,
  countryMax: 100,
  cityMax: 100,
  availabilityMax: 50,
  weeklyAvailabilityMax: 50,
  experienceLevelMax: 50,
  languageMax: 50,
  proficiencyMax: 50,
  portfolioMaxItems: 10,
  portfolioTitleMax: 100,
  portfolioCategoryMax: 100,
  portfolioDescriptionMax: 2000,
  websiteMax: 2048,
  decimalFilterMax: 10,
} as const;

export const AGENCY_LIMITS = {
  nameMax: 100,
  professionalTitleMax: 100,
  specialtyMax: 100,
  sizeMax: 50,
  overviewMax: 5000,
  tagsMaxItems: 15,
  tagMaxLength: 20,
  portfolioMaxItems: 10,
  portfolioTitleMax: 100,
  portfolioCategoryMax: 100,
  portfolioDescriptionMax: 2000,
  websiteMax: 2048,
} as const;

export const CLIENT_LIMITS = {
  professionalRoleMax: 100,
  companyNameMax: 100,
  industryMax: 100,
  companySizeMax: 50,
  companyDescriptionMax: 5000,
  websiteMax: 2048,
} as const;
