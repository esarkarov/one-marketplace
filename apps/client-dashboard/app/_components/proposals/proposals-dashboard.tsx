"use client";

import { Icon } from "@iconify/react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type ClientJob, type ClientProposal } from "../data/client-data";
import { countries } from "@/utils/countries";
import Image from "next/image";

const proposalsPerPage = 2;
const emptyProposalData: any[] = [];
const emptyJobsData: any[] = [];

export function ProposalsDashboard({
  initialJobId = null,
}: {
  initialJobId?: string | null;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const selectedJobId = initialJobId;
  const [filter, setFilter] = useState("All");
  const [proposals, setProposals] = useState<ClientProposal[]>([]);
  const [selectedProposal, setSelectedProposal] =
    useState<ClientProposal | null>(null);
  const [interviewProposal, setInterviewProposal] =
    useState<ClientProposal | null>(null);
  const [contractProposal, setContractProposal] =
    useState<ClientProposal | null>(null);
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);

  const { data: jobs = emptyJobsData, isLoading: jobsLoading } = useQuery<
    ClientJob[]
  >({
    queryKey: ["client-proposals-job-posts"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs?role=client`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data.map((job: any) => ({
        id: job.id,
        title: job.title,
        status:
          job.status === "PUBLISHED"
            ? "Open"
            : job.status === "DRAFT"
              ? "Draft"
              : "Closed",
        posted: job.created_at
          ? `${formatDistanceToNow(new Date(job.created_at))} ago`
          : "Recently",
        budget: Number(job.total_budget),
        level: job.expertise_level,
        duration: job.expected_duration,
        description: job.description,
        skills: job.skills,
        proposals: job.proposalCount ?? 0,
        shortlisted: job.shortlistCount ?? 0,
        hires: job.hireCount ?? 0,
        visibility: "Marketplace",
        screeningQuestions: job.screening_questions ?? [],
        milestones: (job.milestones ?? []).map((milestone: any) => ({
          id: milestone.id,
          title: milestone.title,
          amount: Number(milestone.budget),
          due: milestone.dueDate,
        })),
      }));
    },
  });
  const {
    data: proposalData = emptyProposalData,
    isLoading: proposalsLoading,
  } = useQuery<any[]>({
    queryKey: ["client-proposals", selectedJobId],
    enabled: Boolean(selectedJobId),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/proposals?role=client&jobId=${selectedJobId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });
  useEffect(() => {
    const job = jobs.find((item) => String(item.id) === selectedJobId);

    setProposals(
      proposalData.map((proposal) => ({
        id: proposal.id,
        contractId: proposal.contractId ?? null,
        backendStatus: proposal.status,
        conversationId: proposal.conversationId,
        jobId: selectedJobId!,
        freelancerId: proposal.freelancerId,
        senderId: proposal.senderId,
        memberCount: proposal.memberCount,
        bidder:
          proposal.senderName ??
          (proposal.senderType === "AGENCY" ? "Agency" : "Freelancer"),
        avatarUrl: proposal.avatar,
        initials: (
          proposal.senderName ??
          (proposal.senderType === "AGENCY" ? "Agency" : "Freelancer")
        )
          .split(" ")
          .map((part: string) => part[0])
          .join("")
          .slice(0, 2),
        accountType: proposal.senderType === "AGENCY" ? "Agency" : "Freelancer",
        title:
          proposal.senderType === "AGENCY"
            ? `Agency · ${proposal.memberCount ?? 0} member${proposal.memberCount === 1 ? "" : "s"}`
            : (proposal.professionalTitle ?? "Freelancer"),
        location:
          [
            proposal.city,
            countries.find((country) => country.code === proposal.country)
              ?.name ?? proposal.country,
          ]
            .filter(Boolean)
            .join(", ") || "Location unavailable",
        verified: proposal.verified ?? false,
        online: false,
        rating: Number(proposal.rating ?? 0),
        jobSuccess: Number(proposal.jobSuccessScore ?? 0),
        completedProjects: Number(proposal.completedJobs ?? 0),
        bid: Number(proposal.bidAmount),
        duration: proposal.duration,
        submitted: proposal.submittedAt
          ? `${formatDistanceToNow(new Date(proposal.submittedAt))} ago`
          : "recently",
        coverLetter: proposal.coverLetter,
        skills: proposal.skills ?? [],
        milestonePlan:
          job?.milestones?.map((milestone: any) => ({
            title: milestone.title,
            amount: milestone.amount,
            duration: milestone.due,
          })) ?? [],
        screeningAnswers: proposal.screeningAnswers ?? [],
        status: proposal.isShortlisted
          ? "Shortlisted"
          : proposal.status === "VIEWED"
            ? "New"
            : proposal.status === "INTERVIEWED"
              ? "Interview"
              : "New",
      })),
    );
  }, [jobs, proposalData, selectedJobId]);

  const selectedJob = jobs.find((job) => String(job.id) === selectedJobId);
  const filteredProposals = proposals.filter(
    (proposal) =>
      proposal.jobId === selectedJobId &&
      (filter === "All" || proposal.status === filter),
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredProposals.length / proposalsPerPage),
  );
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * proposalsPerPage;
  const visibleProposals = filteredProposals.slice(
    pageStart,
    pageStart + proposalsPerPage,
  );

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const updateStatus = (
    proposalId: number | string,
    status: ClientProposal["status"],
  ) => {
    setProposals((current) =>
      current.map((proposal) =>
        proposal.id === proposalId ? { ...proposal, status } : proposal,
      ),
    );
    setSelectedProposal((current) =>
      current?.id === proposalId ? { ...current, status } : current,
    );
    setNotice(`Proposal moved to ${status.toLowerCase()}.`);
  };

  const startInterview = (proposal: ClientProposal) => {
    if (proposal.backendStatus === "INTERVIEWED") {
      if (proposal.conversationId) {
        router.push(`/messages?conversationId=${proposal.conversationId}`);
      }
      return;
    }
    setSelectedProposal(null);
    setInterviewProposal(proposal);
  };

  const hireProposal = (proposal: ClientProposal) => {
    setSelectedProposal(null);
    setContractProposal(proposal);
  };

  const startContractCheckout = async (proposal: ClientProposal) => {
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/checkout?role=client`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ proposalId: proposal.id }),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.data?.url) {
      throw new Error(result.message || "Checkout could not be started.");
    }
    window.location.assign(result.data.url);
  };

  const handleProposalUpdateStatus = async (proposal: ClientProposal) => {
    setSelectedProposal(proposal);

    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/proposals/${proposal.id}/status?role=client`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        const result = await response.json();
        throw new Error(
          result.message || "Proposal status could not be updated.",
        );
      }
    } catch (error) {
      console.error("Proposal view status update failed.", error);
    }
  };

  const handleShortList = async (proposal: ClientProposal) => {
    const previousStatus = proposal.status;
    updateStatus(proposal.id, "Shortlisted");

    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/proposals/${proposal.id}/status?role=client`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isShortlisted: true }),
        },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || "Proposal could not be shortlisted.");
      }
    } catch (error) {
      updateStatus(proposal.id, previousStatus);
      setNotice(
        error instanceof Error
          ? error.message
          : "Proposal could not be shortlisted.",
      );
    }
  };

  const submitInterview = async (message: string) => {
    if (!interviewProposal) return;
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/proposals/${interviewProposal.id}/interview?role=client`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Interview could not be started.");
    }
    updateStatus(interviewProposal.id, "Interview");
    setInterviewProposal(null);
    router.push(`/messages?conversationId=${result.data.conversationId}`);
  };

  if (!selectedJob) {
    if (jobsLoading)
      return (
        <div className="mt-8 animate-pulse rounded-2xl border border-black/8 bg-white p-6">
          <div className="h-3 w-20 rounded bg-[#e8ebe6]" />
          <div className="mt-4 h-5 w-72 max-w-full rounded bg-[#dde2db]" />
          <div className="mt-3 h-3 w-48 rounded bg-[#ecefeb]" />
          <div className="mt-6 h-3 w-full rounded bg-[#e8ebe6]" />
          <div className="mt-3 h-3 w-3/4 rounded bg-[#eef0ec]" />
        </div>
      );
    return (
      <>
        <PageHeading />
        <section className="mt-8 grid gap-4">
          {jobs.map((job) => (
            <JobProposalCard
              key={job.id}
              job={job}
              onView={() => router.push(`/proposals/${job.id}`)}
            />
          ))}
        </section>
      </>
    );
  }

  return (
    <>
      <Link
        href="/proposals"
        className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#52784f]"
      >
        <Icon icon="solar:arrow-left-linear" width="15" />
        Back to job posts
      </Link>

      <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
            Proposal review
          </p>
          <h1 className="mt-2 max-w-4xl text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
            {selectedJob.title}
          </h1>
          <p className="mt-2 text-sm text-[#72776f]">
            Compare every freelancer and agency that applied to this job.
          </p>
        </div>
        {selectedJob.hires > 0 ? (
          <Link
            href="/contracts"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold"
          >
            <Icon icon="solar:case-round-linear" width="17" />
            View contract
          </Link>
        ) : (
          <Link
            href={`/jobs/${selectedJob.id}/edit`}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold"
          >
            <Icon icon="solar:pen-2-linear" width="17" />
            Edit job post
          </Link>
        )}
      </div>

      <section className="mt-6 rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <JobMetric
            label="Fixed budget"
            value={`$${selectedJob?.budget?.toLocaleString()}`}
          />
          <JobMetric label="Proposals" value={String(selectedJob.proposals)} />
          <JobMetric
            label="Shortlisted"
            value={String(
              proposals.filter(
                (proposal) =>
                  proposal.jobId === selectedJob.id &&
                  proposal.status === "Shortlisted",
              ).length,
            )}
          />
          <JobMetric label="Hires" value={String(selectedJob.hires)} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-black/7 pt-5">
          {selectedJob.skills.map((skill: any) => (
            <span
              key={skill}
              className="rounded-lg bg-[#f0f3ee] px-2.5 py-1.5 text-[10px] text-[#657062]"
            >
              {skill}
            </span>
          ))}
        </div>
      </section>

      {notice && (
        <p
          role="status"
          className="mt-5 rounded-xl bg-[#e7f2e4] p-3 text-xs font-semibold text-[#4d784a]"
        >
          {notice}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            "All",
            "New",
            "Shortlisted",
            "Interview",
            "Offer sent",
            "Rejected",
            "Hired",
          ].map((item) => {
            const count =
              item === "All"
                ? proposals.filter(
                    (proposal) => proposal.jobId === selectedJob.id,
                  ).length
                : proposals.filter(
                    (proposal) =>
                      proposal.jobId === selectedJob.id &&
                      proposal.status === item,
                  ).length;
            return (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setFilter(item);
                  setPage(1);
                }}
                className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-semibold ${
                  filter === item
                    ? "bg-[#edf4ea] text-[#4e774b]"
                    : "bg-white text-[#6f756d] hover:bg-black/3"
                }`}
              >
                {item}
                <span className="text-[9px] opacity-65">{count}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[#858a82]">
          {filteredProposals.length
            ? `Showing ${pageStart + 1}–${Math.min(
                pageStart + proposalsPerPage,
                filteredProposals.length,
              )} of ${filteredProposals.length} proposals`
            : "No proposals shown"}
        </p>
      </div>

      <div className="mt-5 grid gap-4">
        {proposalsLoading ? (
          <ProposalSkeleton />
        ) : visibleProposals.length ? (
          visibleProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onView={() => handleProposalUpdateStatus(proposal)}
              onShortlist={() => handleShortList(proposal)}
            />
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white p-12 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#edf4ea] text-[#52784f]">
              <Icon icon="solar:users-group-rounded-linear" width="26" />
            </span>
            <h2 className="mt-4 text-sm font-semibold">
              No proposals in this view
            </h2>
            <p className="mt-2 text-xs text-[#858a82]">
              Choose another status or return to your job posts.
            </p>
          </div>
        )}
      </div>

      {filteredProposals.length > proposalsPerPage && (
        <ProposalPagination
          page={currentPage}
          totalPages={totalPages}
          totalResults={filteredProposals.length}
          pageStart={pageStart}
          onPageChange={setPage}
        />
      )}

      {selectedProposal && (
        <ProposalDrawer
          proposal={selectedProposal}
          onClose={() => setSelectedProposal(null)}
          onInterview={() => startInterview(selectedProposal)}
          onHire={() => hireProposal(selectedProposal)}
        />
      )}

      {interviewProposal && (
        <StartInterviewModal
          proposal={interviewProposal}
          onClose={() => setInterviewProposal(null)}
          onSubmit={submitInterview}
        />
      )}

      {contractProposal && (
        <FundContractModal
          proposal={contractProposal}
          onClose={() => setContractProposal(null)}
          onPay={() => startContractCheckout(contractProposal)}
        />
      )}
    </>
  );
}

function ProposalPagination({
  page,
  totalPages,
  totalResults,
  pageStart,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalResults: number;
  pageStart: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav
      aria-label="Proposals pagination"
      className="mt-5 flex flex-col gap-3 rounded-2xl border border-black/8 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-[10px] text-[#858a82]">
        Showing {pageStart + 1}–
        {Math.min(pageStart + proposalsPerPage, totalResults)} of {totalResults}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous proposals page"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-black/10 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Icon icon="solar:alt-arrow-left-linear" width="16" />
        </button>
        {Array.from({ length: totalPages }, (_, index) => {
          const pageNumber = index + 1;
          const active = pageNumber === page;

          return (
            <button
              key={pageNumber}
              type="button"
              aria-label={`Open proposals page ${pageNumber}`}
              aria-current={active ? "page" : undefined}
              onClick={() => onPageChange(pageNumber)}
              className={`h-9 min-w-9 cursor-pointer rounded-lg px-3 text-xs font-semibold ${
                active
                  ? "bg-[#e9f1e6] text-[#4f794c]"
                  : "border border-black/10 text-[#656b63]"
              }`}
            >
              {pageNumber}
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Next proposals page"
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-black/10 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Icon icon="solar:alt-arrow-right-linear" width="16" />
        </button>
      </div>
    </nav>
  );
}

function PageHeading() {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
          Talent review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
          Proposals
        </h1>
        <p className="mt-2 text-sm text-[#72776f]">
          Choose a job post to review its freelancers and agencies.
        </p>
      </div>
      <Link
        href="/jobs/new"
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white"
      >
        <Icon icon="solar:add-circle-linear" width="18" />
        Post another job
      </Link>
    </div>
  );
}

function JobProposalCard({
  job,
  onView,
}: {
  job: ClientJob;
  onView: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-black/8 bg-white">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                  job.status === "Open"
                    ? "bg-[#e7f2e4] text-[#4d784a]"
                    : job.status === "Draft"
                      ? "bg-[#f1f0e7] text-[#766f47]"
                      : "bg-[#f0f1ef] text-[#767b74]"
                }`}
              >
                {job.status}
              </span>
              <span className="text-[10px] text-[#8a8f87]">{job.posted}</span>
            </div>
            <h2 className="mt-3 text-lg font-semibold">{job.title}</h2>
            <p className="mt-2 text-xs text-[#757b73]">
              Fixed price · ${job?.budget?.toLocaleString()} · {job.level} ·{" "}
              {job.duration}
            </p>
            <p className="mt-4 line-clamp-2 max-w-4xl text-sm leading-6 text-[#6f756d]">
              {job.description}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:min-w-72">
            <JobMetric label="Proposals" value={String(job.proposals)} />
            <JobMetric label="Shortlisted" value={String(job.shortlisted)} />
            <JobMetric label="Hires" value={String(job.hires)} />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {job.skills.slice(0, 5).map((skill) => (
            <span
              key={skill}
              className="rounded-lg bg-[#f0f3ee] px-2.5 py-1.5 text-[10px] text-[#657062]"
            >
              {skill}
            </span>
          ))}
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-black/7 bg-[#fafbf9] px-5 py-4 sm:px-6">
        <p className="text-xs text-[#858a82]">
          {job.proposals
            ? `${job.proposals} people and agencies applied`
            : "No proposals received yet"}
        </p>
        <button
          type="button"
          disabled={job.proposals === 0}
          onClick={onView}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#c2c5c0]"
        >
          View proposals
          <Icon icon="solar:arrow-right-linear" width="15" />
        </button>
      </footer>
    </article>
  );
}

function ProposalCard({
  proposal,
  onView,
  onShortlist,
}: {
  proposal: ClientProposal;
  onView: () => void;
  onShortlist: () => void;
}) {
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex min-w-0 flex-1 gap-4">
          <span className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#527a73] text-sm font-semibold text-white">
            {proposal.avatarUrl ? (
              <Image
                src={proposal.avatarUrl}
                alt={proposal.bidder}
                fill
                className="rounded-full object-cover"
              />
            ) : (
              proposal.initials
            )}
            {proposal.online && (
              <span className="absolute right-0 bottom-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#5ca568]" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{proposal.bidder}</h2>
              <span className="rounded-full bg-[#f0f3ee] px-2 py-1 text-[9px] font-semibold text-[#627260]">
                {proposal.accountType}
              </span>
              {proposal.verified && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#52784f]">
                  <Icon icon="solar:verified-check-bold" width="14" />
                  Verified
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#70766e]">{proposal.title}</p>
            <p className="mt-2 text-xs text-[#8a8f87]">
              {proposal.location} · Submitted {proposal.submitted}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-left sm:grid-cols-4 lg:text-right">
          <Mini label="Bid" value={`$${proposal.bid.toLocaleString()}`} />
          <Mini label="Duration" value={proposal.duration} />
          <Mini label="Success" value={`${proposal.jobSuccess}%`} />
          <Mini label="Rating" value={String(proposal.rating)} />
        </div>
      </div>
      <p className="mt-5 line-clamp-2 text-sm leading-6 text-[#686e66]">
        {proposal.coverLetter}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {proposal.skills.map((skill) => (
          <span
            key={skill}
            className="rounded-lg bg-[#f0f3ee] px-2.5 py-1.5 text-[10px]"
          >
            {skill}
          </span>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/7 pt-4">
        <span className="rounded-full bg-[#edf4ea] px-3 py-1.5 text-[10px] font-semibold text-[#4e774b]">
          {proposal.status}
        </span>
        <div className="flex flex-wrap gap-2">
          <a
            href={getProfileHref(proposal)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-black/10 px-4 py-3 text-xs font-semibold"
          >
            View profile
            <Icon icon="solar:arrow-right-up-linear" width="14" />
          </a>
          <button
            type="button"
            onClick={onView}
            className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
          >
            View proposal
          </button>
          {proposal.status !== "Shortlisted" && (
            <button
              type="button"
              onClick={onShortlist}
              className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white"
            >
              Shortlist
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function JobMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f3f5f1] p-3">
      <p className="text-base font-semibold">{value}</p>
      <p className="mt-1 text-[9px] text-[#858a82]">{label}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-semibold">{value}</p>
      <p className="mt-1 text-[9px] text-[#8a8f87]">{label}</p>
    </div>
  );
}

function ProposalDrawer({
  proposal,
  onClose,
  onInterview,
  onHire,
}: {
  proposal: ClientProposal;
  onClose: () => void;
  onInterview: () => void;
  onHire: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/25"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="absolute top-0 right-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#62805f]">
              {proposal.accountType} proposal
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{proposal.bidder}</h2>
            <p className="mt-1 text-sm text-[#747a72]">{proposal.title}</p>
          </div>
          <button type="button" onClick={onClose}>
            <Icon icon="solar:close-circle-linear" width="24" />
          </button>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            ["Bid", `$${proposal.bid.toLocaleString()}`],
            ["Duration", proposal.duration],
            ["Completed", String(proposal.completedProjects)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-[#f3f5f1] p-4">
              <p className="text-[10px] text-[#858a82]">{label}</p>
              <p className="mt-1 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <section className="mt-6">
          <h3 className="text-sm font-semibold">Cover letter</h3>
          <p className="mt-3 text-sm leading-7 whitespace-pre-wrap text-[#686e66]">
            {proposal.coverLetter}
          </p>
        </section>
        <section className="mt-6">
          <h3 className="text-sm font-semibold">Proposed milestones</h3>
          <div className="mt-3 divide-y divide-black/6 rounded-xl border border-black/7">
            {proposal.milestonePlan.map((item) => (
              <div key={item.title} className="flex justify-between gap-4 p-4">
                <div>
                  <p className="text-xs font-semibold">{item.title}</p>
                  <p className="mt-1 text-[10px] text-[#858a82]">
                    {item.duration}
                  </p>
                </div>
                <p className="text-xs font-semibold">
                  ${item.amount.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </section>

        {!!proposal.screeningAnswers?.length && (
          <section className="mt-6">
            <h3 className="text-sm font-semibold">Screening answers</h3>
            <div className="mt-3 grid gap-3">
              {proposal.screeningAnswers.map((item) => (
                <div
                  key={item.question}
                  className="rounded-xl border border-black/7 p-4"
                >
                  <p className="text-xs font-semibold">{item.question}</p>
                  <p className="mt-2 text-sm leading-6 text-[#686e66]">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
        <a
          href={getProfileHref(proposal)}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl border border-black/10 px-4 text-xs font-semibold"
        >
          <Icon
            icon={
              proposal.accountType === "Agency"
                ? "solar:buildings-2-linear"
                : "solar:user-circle-linear"
            }
            width="18"
          />
          View {proposal.accountType.toLowerCase()} profile
          <Icon icon="solar:arrow-right-up-linear" width="14" />
        </a>
        <div className="mt-7 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onInterview}
            className="h-11 rounded-xl border border-black/10 px-4 text-xs font-semibold"
          >
            {proposal.backendStatus === "INTERVIEWED"
              ? "Go to interview"
              : "Start interview"}
          </button>
          {proposal.contractId ? (
            <Link
              href={`/contracts?contractId=${proposal.contractId}`}
              className="inline-flex h-11 items-center rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white"
            >
              See contract
            </Link>
          ) : (
            <button
              type="button"
              onClick={onHire}
              className="h-11 rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white"
            >
              Send contract offer
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function ProposalSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-black/8 bg-white p-6">
      <div className="flex gap-4">
        <div className="h-14 w-14 rounded-2xl bg-[#e5e9e3]" />
        <div className="flex-1">
          <div className="h-4 w-40 rounded bg-[#dde2db]" />
          <div className="mt-3 h-3 w-56 rounded bg-[#ecefeb]" />
        </div>
      </div>
      <div className="mt-6 h-3 w-full rounded bg-[#e8ebe6]" />
      <div className="mt-3 h-3 w-3/4 rounded bg-[#eef0ec]" />
    </div>
  );
}

function getProfileHref(proposal: ClientProposal) {
  return proposal.accountType === "Agency"
    ? `/agency/${proposal.senderId}`
    : `/talent/${proposal.freelancerId}`;
}

function FundContractModal({
  proposal,
  onClose,
  onPay,
}: {
  proposal: ClientProposal;
  onClose: () => void;
  onPay: () => Promise<void>;
}) {
  const milestone = proposal.milestonePlan[0];
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState("");

  const handlePay = async () => {
    setIsPaying(true);
    setError("");
    try {
      await onPay();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Checkout failed.");
      setIsPaying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-[3px]"
      onMouseDown={(event) =>
        !isPaying && event.target === event.currentTarget && onClose()
      }
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[.12em] text-[#62805f] uppercase">
              Send contract offer
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              Fund the first milestone
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#747a72]">
              Fund the first milestone before sending the contract to {" "}
              {proposal.bidder}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPaying}
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" width="24" />
          </button>
        </div>

        {milestone ? (
          <>
            <div className="mt-6 rounded-2xl border border-black/8 bg-[#f7f8f5] p-5">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="text-[10px] font-semibold tracking-[.1em] text-[#6f756d] uppercase">
                    Milestone 1
                  </p>
                  <h3 className="mt-2 text-sm font-semibold">
                    {milestone.title}
                  </h3>
                  <p className="mt-1 text-xs text-[#7c827a]">
                    Due {milestone.duration}
                  </p>
                </div>
                <strong className="text-lg">
                  ${milestone.amount.toLocaleString()}
                </strong>
              </div>
            </div>

            <div className="mt-5 grid gap-3 border-y border-black/7 py-4 text-sm">
              <div className="flex items-center justify-between text-[#6d736b]">
                <span>Milestone funding</span>
                <span>${milestone.amount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between font-semibold">
                <span>Amount due today</span>
                <span>${milestone.amount.toLocaleString()}</span>
              </div>
            </div>

            <div className="mt-5 flex gap-3 rounded-xl bg-[#edf4ea] p-4">
              <Icon
                icon="solar:shield-check-linear"
                width="20"
                className="shrink-0 text-[#52784f]"
              />
              <p className="text-xs leading-5 text-[#657063]">
                The milestone payment will be secured until the work is
                completed and approved.
              </p>
            </div>
          </>
        ) : (
          <p className="mt-6 rounded-xl bg-[#fff4e8] p-4 text-sm text-[#8a643f]">
            This job does not have a milestone to fund.
          </p>
        )}

        {error && <p className="mt-4 text-xs text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPaying}
            className="h-11 rounded-xl border border-black/10 px-4 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePay}
            disabled={!milestone || isPaying}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon icon="solar:card-2-linear" width="17" />
            {isPaying ? "Redirecting..." : "Pay Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StartInterviewModal({
  proposal,
  onClose,
  onSubmit,
}: {
  proposal: ClientProposal;
  onClose: () => void;
  onSubmit: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-[3px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!message.trim() || isSubmitting) return;
          setError("");
          setIsSubmitting(true);
          try {
            await onSubmit(message.trim());
          } catch (submitError) {
            setError(
              submitError instanceof Error
                ? submitError.message
                : "Interview could not be started.",
            );
            setIsSubmitting(false);
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[.12em] text-[#62805f] uppercase">
              Start interview
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              Message {proposal.bidder}
            </h2>
            <p className="mt-2 text-sm text-[#747a72]">
              Introduce yourself and explain the next step in the interview.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting}>
            <Icon icon="solar:close-circle-linear" width="24" />
          </button>
        </div>
        <textarea
          autoFocus
          required
          maxLength={5000}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Hi, I reviewed your proposal and would like to discuss..."
          className="mt-5 min-h-36 w-full resize-y rounded-xl border border-black/10 p-4 text-sm outline-none focus:border-[#62805f]"
        />
        {error && <p className="mt-2 text-xs text-[#9a5a5a]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-11 rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!message.trim() || isSubmitting}
            className="h-11 rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Starting..." : "Start interview"}
          </button>
        </div>
      </form>
    </div>
  );
}
