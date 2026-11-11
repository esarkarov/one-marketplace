import { z } from "zod";

import { authRoleShape, boundedText, uuidParam } from "./common-schemas.js";
import { moneyCents } from "./money.js";
import { PROPOSAL_LIMITS } from "./validation-limits.js";

export const MAX_BID_CENTS = 100_000_000;

export const submitProposalBodySchema = z.strictObject(
  {
    ...authRoleShape,
    jobId: uuidParam("Job post"),
    coverLetter: boundedText("Cover letter", {
      min: PROPOSAL_LIMITS.coverLetterMin,
      max: PROPOSAL_LIMITS.coverLetterMax,
    }),
    bidAmountCents: moneyCents
      .min(1, { error: "Enter a valid bid amount." })
      .max(MAX_BID_CENTS, { error: "Enter a valid bid amount." }),
    duration: boundedText("Delivery duration", {
      max: PROPOSAL_LIMITS.durationMax,
    }),
    screeningAnswers: z
      .array(
        boundedText("Screening answer", {
          min: 0,
          max: PROPOSAL_LIMITS.screeningAnswerMaxLength,
        }),
        { error: "Screening answers must be an array." },
      )
      .max(PROPOSAL_LIMITS.screeningAnswersMaxItems, {
        error: `At most ${PROPOSAL_LIMITS.screeningAnswersMaxItems} screening answers are allowed.`,
      })
      .optional(),
  },
  { error: "Request body must be an object." },
);

export const centsQueryParam = z
  .string()
  .regex(/^\d+$/, {
    error: "Amount filter must be an integer number of cents.",
  })
  .transform(Number)
  .pipe(moneyCents)
  .optional();
