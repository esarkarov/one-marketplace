"use client";

import { DashboardHeader } from "@/app/_components/dashboard/dashboard-header";
import { useProposalMetadata } from "@/app/_components/proposals/use-proposal-metadata";
import { countries } from "@/utils/countries";
import { useAuth, useUser } from "@clerk/nextjs";
import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useMemo } from "react";
import { format } from "timeago.js";

type JobDetailsData = {
  id: string;
  title: string;
  description: string;
  expertise_level: string;
  expected_duration: string;
  skills: string[];
  total_budget: string;
  milestones: Array<{
    id: string;
    title: string;
    budget: number;
    dueDate: string;
  }>;
  screening_questions: string[] | null;
  attachments: Array<{
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize: number;
  }> | null;
  published_at: string | null;
  created_at: string | null;
  companyName: string;
  companyDescription: string;
  clientCountry: string | null;
  paymentVerified: boolean;
  clientJoinedAt: string | null;
  proposalCount: number;
  hireCount: number;
  clientTotalSpent?: number;
  clientRating?: number;
  clientReviewCount?: number;
};

const proposalLabel = (count: number) => {
  if (count < 5) return "Less than 5 proposals";
  if (count < 10) return "5 to 10 proposals";
  if (count < 15) return "10 to 15 proposals";
  if (count < 20) return "15 to 20 proposals";
  return "20+ proposals";
};

const JobDetailsSkeleton = () => (
  <main className="mx-auto grid max-w-7xl animate-pulse items-start gap-7 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_330px] lg:py-12">
    <div className="rounded-3xl border border-black/8 bg-white p-9">
      <div className="h-3 w-36 rounded bg-[#e6e9e3]" />
      <div className="mt-5 h-9 w-4/5 rounded bg-[#dde2da]" />
      <div className="mt-8 flex gap-2">
        {[24, 16, 20].map((width) => (
          <div
            key={width}
            className="h-8 rounded-lg bg-[#e8ebe5]"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
      {[0, 1, 2].map((item) => (
        <div key={item} className="mt-10 border-t border-black/7 pt-8">
          <div className="h-6 w-52 rounded bg-[#dfe3dc]" />
          <div className="mt-5 h-3 w-full rounded bg-[#e8ebe5]" />
          <div className="mt-3 h-3 w-4/5 rounded bg-[#e8ebe5]" />
        </div>
      ))}
    </div>
    <div className="h-72 rounded-3xl border border-black/8 bg-white p-6">
      <div className="h-3 w-28 rounded bg-[#e8ebe5]" />
      <div className="mt-4 h-9 w-36 rounded bg-[#dde2da]" />
      <div className="mt-8 h-12 rounded-xl bg-[#e4e8e1]" />
      <div className="mt-3 h-12 rounded-xl bg-[#edf0eb]" />
    </div>
  </main>
);

const JobDetails = () => {
  const { id } = useParams<{ id: string }>();
  const { user, isLoaded: userLoaded } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();

  const {
    data: job,
    isLoading,
    isError,
  } = useQuery<JobDetailsData>({
    queryKey: ["freelancer-job", id],
    enabled: Boolean(user && id),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/jobs/${id}?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "Job post could not be loaded.");
      return result.data;
    },
  });

  const { data: proposalMetadata, isLoading: proposalMetadataLoading } =
    useProposalMetadata();

  const hasApplied =
    proposalMetadata?.proposals?.some((proposal) => proposal.jobId === id) ??
    false;

  const appliedJobIds = useMemo(
    () =>
      new Set(
        proposalMetadata?.proposals?.map((proposal) => proposal.jobId) ?? [],
      ),
    [proposalMetadata],
  );

  return (
    <div className="min-h-svh bg-[#f4f6f2] font-(family-name:--font-dm-sans) text-[#242724]">
      <DashboardHeader />

      {isLoading || !userLoaded ? (
        <JobDetailsSkeleton />
      ) : isError || !job ? (
        <main className="mx-auto max-w-3xl px-5 py-24 text-center">
          <Icon
            icon="solar:case-minimalistic-linear"
            width="42"
            className="mx-auto text-[#6b7168]"
          />
          <h1 className="mt-5 text-2xl font-semibold">Job post unavailable</h1>
          <p className="mt-2 text-sm text-[#747a72]">
            This job may have been removed or is no longer accepting proposals.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-xl bg-[#252724] px-5 py-3 text-sm font-semibold text-white!"
          >
            Back to jobs
          </Link>
        </main>
      ) : (
        <main className="mx-auto grid max-w-7xl items-start gap-7 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_330px] lg:py-12">
          <button
            type="button"
            onClick={() =>
              window.history.length > 1 ? router.back() : router.push("/")
            }
            className="flex w-fit cursor-pointer items-center gap-2 text-sm font-semibold text-[#52784f] hover:text-[#355c33] lg:col-span-2"
          >
            <Icon icon="solar:arrow-left-linear" width="19" />
            Back to jobs
          </button>

          <article className="overflow-hidden rounded-3xl border border-black/8 bg-white">
            <div className="border-b border-black/7 p-6 sm:p-9">
              <p className="text-xs text-[#7a8078]">
                Posted{" "}
                {format(job.published_at ?? job.created_at ?? new Date())} ·
                Worldwide
              </p>
              <h1 className="mt-4 max-w-3xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-4xl">
                {job.title}
              </h1>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-lg bg-[#edf4ea] px-3 py-2 text-xs font-semibold text-[#4e774b]">
                  Fixed-price project
                </span>
                <span className="rounded-lg bg-[#f2f3f0] px-3 py-2 text-xs font-medium">
                  {job.expertise_level}
                </span>
                <span className="rounded-lg bg-[#f2f3f0] px-3 py-2 text-xs font-medium">
                  {job.expected_duration}
                </span>
              </div>
            </div>

            <div className="p-6 sm:p-9">
              <section>
                <h2 className="text-xl font-semibold tracking-tight">
                  About the project
                </h2>
                <p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#626860]">
                  {job.description}
                </p>
              </section>

              <section className="mt-9 border-t border-black/7 pt-8">
                <h2 className="text-xl font-semibold tracking-tight">
                  Skills and expertise
                </h2>
                <div className="mt-5 flex flex-wrap gap-2">
                  {job.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-lg bg-[#eef2ec] px-3 py-2 text-xs font-medium text-[#596057]"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </section>

              <section className="mt-9 border-t border-black/7 pt-8">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">
                      Project milestones
                    </h2>
                    <p className="mt-1 text-sm text-[#7a8078]">
                      Payments release as each milestone is approved.
                    </p>
                  </div>
                  <strong className="text-xl">
                    ${Number(job.total_budget).toLocaleString()}
                  </strong>
                </div>
                <div className="mt-5 overflow-hidden rounded-2xl border border-black/8">
                  {job.milestones.map((milestone, index) => (
                    <div
                      key={milestone.id}
                      className={`flex items-center gap-4 p-5 ${index ? "border-t border-black/7" : ""}`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e9f2e6] text-xs font-semibold text-[#4d764a]">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold">{milestone.title}</h3>
                        <p className="mt-1 text-xs text-[#777d75]">
                          Due {new Date(milestone.dueDate).toLocaleDateString()}
                        </p>
                      </div>
                      <strong className="shrink-0 text-sm">
                        ${Number(milestone.budget).toLocaleString()}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>

              {!!job.screening_questions?.length && (
                <section className="mt-9 border-t border-black/7 pt-8">
                  <h2 className="text-xl font-semibold tracking-tight">
                    Screening questions
                  </h2>
                  <ul className="mt-4 grid gap-3 text-sm text-[#626860] sm:grid-cols-2">
                    {job.screening_questions.map((question) => (
                      <li
                        key={question}
                        className="flex gap-3 rounded-xl bg-[#f6f7f4] p-4"
                      >
                        <Icon
                          icon="solar:question-circle-linear"
                          width="19"
                          className="mt-0.5 shrink-0 text-[#5b8458]"
                        />
                        <span>{question}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!!job.attachments?.length && (
                <section className="mt-9 border-t border-black/7 pt-8">
                  <h2 className="text-xl font-semibold tracking-tight">
                    Project attachments
                  </h2>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {job.attachments.map((attachment) => (
                      <a
                        key={attachment.fileId}
                        href={attachment.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-xl border border-black/8 p-4 text-sm font-medium hover:bg-[#f6f7f4]"
                      >
                        <Icon
                          icon="solar:paperclip-linear"
                          width="20"
                          className="text-[#568153]"
                        />
                        <span className="truncate">{attachment.fileName}</span>
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </article>

          <aside className="grid gap-5 lg:sticky lg:top-23">
            <section className="rounded-3xl border border-black/8 bg-white p-6 shadow-lg shadow-black/3">
              <p className="text-xs font-medium text-[#7c8179]">
                Total fixed budget
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                ${Number(job.total_budget).toLocaleString()}
              </p>
              <p className="mt-2 text-xs leading-5 text-[#777d75]">
                Protected through milestone-based payments.
              </p>
              {proposalMetadataLoading || hasApplied ? (
                <button
                  type="button"
                  disabled
                  className="mt-6 flex w-full cursor-not-allowed items-center justify-center rounded-xl bg-[#dfe3dc] px-5 py-3 text-sm font-semibold text-[#747a72]"
                >
                  {hasApplied ? "Proposal submitted" : "Checking proposal..."}
                </button>
              ) : (
                <>
                  <Link
                    href={`/?proposal=${id}`}
                    className="mt-6 flex w-full items-center justify-center rounded-xl bg-[#252724] px-5 py-3 text-sm font-semibold text-white! hover:bg-[#3b3e39]"
                  >
                    Submit a proposal
                  </Link>

                  <button
                    type="button"
                    disabled={appliedJobIds.has(job.id)}
                    className="mt-3 disabled:opacity-50 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-black/10 px-5 py-3 text-sm font-semibold hover:bg-black/3"
                  >
                    <Icon icon="solar:bookmark-linear" width="18" /> Save job
                  </button>
                </>
              )}

              <p className="mt-5 text-center text-xs text-[#81867e]">
                {proposalLabel(job.proposalCount)} · {job.hireCount} hired
              </p>
            </section>

            <section className="rounded-3xl border border-black/8 bg-white p-6">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{job.companyName}</h2>
                {job?.paymentVerified && (
                  <Icon
                    icon="solar:verified-check-bold"
                    width="17"
                    className="text-[#568153]"
                  />
                )}
              </div>
              <p
                className={`mt-1 text-xs font-medium ${job.paymentVerified ? "text-[#548050]" : "text-[#a6534d]"}`}
              >
                Payment {job.paymentVerified ? "verified" : "not verified"}
              </p>
              <p className="mt-5 text-sm leading-6 text-[#6f756d]">
                {job.companyDescription}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-y-5 text-sm">
                {job?.clientCountry && (
                  <div>
                    <p className="font-semibold">
                      {
                        countries.find(
                          (country) => country.code === job.clientCountry,
                        )?.name
                      }
                    </p>
                    <p className="mt-1 text-xs text-[#838880]">
                      Client location
                    </p>
                  </div>
                )}
                <div>
                  <p className="font-semibold">
                    ${(job.clientTotalSpent ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-[#838880]">Total spent</p>
                </div>
                <div>
                  <p className="font-semibold flex items-center gap-1">
                    {job.clientRating && job.clientRating > 0 ? (
                      <>
                        <span>{job.clientRating.toFixed(1)}</span>
                        <Icon
                          icon="solar:star-bold"
                          className="text-[#d2a43a]"
                          width="14"
                        />
                        {job.clientReviewCount ? (
                          <span className="text-xs font-normal text-[#838880]">
                            ({job.clientReviewCount})
                          </span>
                        ) : null}
                      </>
                    ) : (
                      "N/A"
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[#838880]">Client Ratings</p>
                </div>
                <div>
                  <p className="font-semibold">
                    Client since{" "}
                    {job?.clientJoinedAt
                      ? new Date(job.clientJoinedAt).getFullYear()
                      : "recently"}
                  </p>
                  <p className="mt-1 text-xs text-[#838880]">
                    OneMarketplace.io client
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </main>
      )}
    </div>
  );
};

export default JobDetails;
