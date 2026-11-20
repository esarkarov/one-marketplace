"use client";

import { useAuth } from "@clerk/nextjs";
import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { JobPostForm, type InitialJobPost } from "./job-post-form";

type JobPostResponse = {
  id: string;
  title: string;
  description: string;
  expertise_level: string;
  expected_duration: string;
  skills: string[];
  milestones: { title: string; budget: number; dueDate: string }[];
  screening_questions: string[] | null;
  attachments: InitialJobPost["attachments"] | null;
  status: string;
};

export function EditJobPost({ jobId }: { jobId: string }) {
  const { getToken } = useAuth();
  const {
    data: job,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["client-job-post", jobId],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired.");
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs/${jobId}?role=client`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await response.json();
      if (!response.ok || !result.data)
        throw new Error(result.message || "Job post could not be loaded.");
      return result.data as JobPostResponse;
    },
  });

  if (isLoading) return <EditJobPostSkeleton />;
  if (error || !job)
    return (
      <div className="rounded-2xl border border-black/8 bg-white p-8 text-center text-sm text-[#737970]">
        {error?.message || "Job post not found."}
      </div>
    );
  if (job.status === "HIRED") return <LockedJob />;

  const initialJob: InitialJobPost = {
    id: job.id,
    title: job.title,
    description: job.description,
    level: job.expertise_level,
    duration: job.expected_duration,
    skills: job.skills,
    milestones: job.milestones.map(({ title, budget, dueDate }) => ({
      title,
      amount: budget,
      due: dueDate,
    })),
    screeningQuestions: job.screening_questions ?? [],
    attachments: job.attachments ?? [],
  };
  
  const formKey = `${job.id}-${initialJob.attachments.map(({ fileId }) => fileId).join("-")}`;

  return (
    <>
      <PageHeader />
      <JobPostForm key={formKey} initialJob={initialJob} />
    </>
  );
}

function PageHeader() {
  return (
    <div>
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#52784f]"
      >
        <Icon icon="solar:arrow-left-linear" width="15" />
        Back to job posts
      </Link>
      <p className="mt-6 text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
        Hiring
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
        Edit job post
      </h1>
      <p className="mt-2 text-sm text-[#72776f]">
        Update the scope, requirements, and milestones before making a hire.
      </p>
    </div>
  );
}

function LockedJob() {
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-black/8 bg-white p-7 text-center sm:p-10">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f1f0e7] text-[#766f47]">
        <Icon icon="solar:lock-keyhole-linear" width="30" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold">This job post is locked</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-[#737970]">
        You hired talent from this job post, so it can no longer be edited.
      </p>
      <Link
        href="/contracts"
        className="mt-6 inline-flex h-11 rounded-xl bg-[#252724] px-5 py-3 text-sm font-semibold text-white"
      >
        View contract
      </Link>
    </section>
  );
}

function EditJobPostSkeleton() {
  return (
    <div className="animate-pulse" aria-label="Loading job post">
      <div className="h-3 w-28 rounded bg-[#e1e5df]" />
      <div className="mt-6 h-3 w-16 rounded bg-[#e7eae5]" />
      <div className="mt-3 h-9 w-56 rounded-lg bg-[#dde1db]" />
      <div className="mt-3 h-3 w-96 max-w-full rounded bg-[#e7eae5]" />

      <div className="mt-8 grid gap-5">
        <SkeletonSection>
          <div className="h-11 rounded-xl bg-[#edf0eb]" />
          <div className="h-36 rounded-xl bg-[#edf0eb]" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-11 rounded-xl bg-[#edf0eb]" />
            <div className="h-11 rounded-xl bg-[#edf0eb]" />
          </div>
        </SkeletonSection>

        <SkeletonSection>
          <div className="h-11 rounded-xl bg-[#edf0eb]" />
          <div className="flex gap-2">
            <span className="h-7 w-20 rounded-full bg-[#e5ebe2]" />
            <span className="h-7 w-24 rounded-full bg-[#e5ebe2]" />
            <span className="h-7 w-16 rounded-full bg-[#e5ebe2]" />
          </div>
        </SkeletonSection>

        <SkeletonSection>
          <div className="h-20 rounded-xl bg-[#edf0eb]" />
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="grid gap-3 rounded-xl border border-black/6 p-4 sm:grid-cols-[1fr_150px_150px]"
            >
              <div className="h-10 rounded-lg bg-[#edf0eb]" />
              <div className="h-10 rounded-lg bg-[#edf0eb]" />
              <div className="h-10 rounded-lg bg-[#edf0eb]" />
            </div>
          ))}
        </SkeletonSection>
      </div>

      <div className="mt-5 flex justify-end gap-2 rounded-2xl border border-black/6 bg-white p-4">
        <span className="h-11 w-28 rounded-xl bg-[#edf0eb]" />
        <span className="h-11 w-32 rounded-xl bg-[#dfe3dd]" />
      </div>
    </div>
  );
}

function SkeletonSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-5 rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
      <div className="grid gap-2">
        <span className="h-4 w-40 rounded bg-[#dfe3dd]" />
        <span className="h-3 w-72 max-w-full rounded bg-[#ecefeb]" />
      </div>
      <div className="grid gap-4 border-t border-black/7 pt-5">{children}</div>
    </div>
  );
}
