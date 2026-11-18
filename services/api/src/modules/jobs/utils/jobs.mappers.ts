interface JobPostRowFields {
  client_id: string;
  expertise_level: string;
  expected_duration: string;
  total_budget_cents: number;
  screening_questions: string[] | null;
  published_at: Date | null;
  hired_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

type JobPostResponse<T extends JobPostRowFields> = Omit<
  T,
  keyof JobPostRowFields
> & {
  clientId: string;
  expertiseLevel: string;
  expectedDuration: string;
  totalBudgetCents: number;
  screeningQuestions: string[] | null;
  publishedAt: Date | null;
  hiredAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export const toJobPostResponse = <T extends JobPostRowFields>(
  job: T,
): JobPostResponse<T> => {
  const {
    client_id,
    expertise_level,
    expected_duration,
    total_budget_cents,
    screening_questions,
    published_at,
    hired_at,
    created_at,
    updated_at,
    ...rest
  } = job;
  return {
    ...rest,
    clientId: client_id,
    expertiseLevel: expertise_level,
    expectedDuration: expected_duration,
    totalBudgetCents: total_budget_cents,
    screeningQuestions: screening_questions,
    publishedAt: published_at,
    hiredAt: hired_at,
    createdAt: created_at,
    updatedAt: updated_at,
  };
};

interface SavedJobLinkRow {
  id: string;
  job_id: string;
  freelancer_id: string;
  created_at: Date | null;
}

export const toSavedJobLinkResponse = (link: SavedJobLinkRow) => ({
  id: link.id,
  jobId: link.job_id,
  freelancerId: link.freelancer_id,
  createdAt: link.created_at,
});
