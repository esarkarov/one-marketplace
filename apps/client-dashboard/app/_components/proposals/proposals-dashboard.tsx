"use client";

import { Icon } from "@iconify/react";
import { formatCents } from "@onemarketplace/api-client";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useJob, useJobs } from "@/app/hooks/use-jobs";
import {
  useContractCheckout,
  useJobProposals,
  useMarkProposalViewed,
  useShortlistProposal,
  useStartInterview,
} from "@/app/hooks/use-proposals";
import {
  isJobLocked,
  isJobNotFound,
  isJobOpen,
  jobErrorMessage,
  jobStatusLabel,
  type JobPost,
} from "@/lib/jobs";
import {
  canSendOffer,
  canStartInterview,
  countByFilter,
  hasInterview,
  INTERVIEW_MESSAGE_MAX,
  matchesFilter,
  messagesHref,
  profileHref,
  PROPOSAL_FILTERS,
  proposalErrorMessage,
  toProposalViews,
  type ProposalView,
} from "@/lib/proposals";
import { isHttpsUrl } from "@/lib/url";
import { countries } from "@/utils/countries";

const PAGE_BUTTON =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#6e916a] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40";

const countryName = (code: string): string | undefined =>
  countries.find((country) => country.code === code)?.name;

const relativeTime = (iso: string | null, fallback: string): string =>
  iso ? `${formatDistanceToNow(new Date(iso))} ago` : fallback;

export function ProposalsDashboard({
  initialJobId = null,
}: {
  initialJobId?: string | null;
}) {
  return initialJobId ? <JobProposals jobId={initialJobId} /> : <JobPicker />;
}

function PagerNav({
  label,
  page,
  hasMore,
  busy,
  onPage,
}: {
  label: string;
  page: number;
  hasMore: boolean;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  if (page === 0 && !hasMore) return null;
  return (
    <nav
      aria-label={label}
      className="mt-5 flex items-center justify-between gap-3"
    >
      <button
        type="button"
        disabled={page === 0 || busy}
        onClick={() => onPage(Math.max(page - 1, 0))}
        className={PAGE_BUTTON}
      >
        <Icon icon="solar:alt-arrow-left-linear" width="16" />
        Previous
      </button>
      <span className="text-xs text-[#858a82]">Page {page + 1}</span>
      <button
        type="button"
        disabled={!hasMore || busy}
        onClick={() => onPage(page + 1)}
        className={PAGE_BUTTON}
      >
        Next
        <Icon icon="solar:alt-arrow-right-linear" width="16" />
      </button>
    </nav>
  );
}

function JobPicker() {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const { data, isLoading, isFetching, error } = useJobs(page);
  const jobs = data?.results ?? [];

  if (isLoading) return <PageSkeleton />;

  return (
    <>
      <PageHeading />
      {error ? (
        <Notice text={jobErrorMessage(error)} />
      ) : (
        <section className="mt-8 grid gap-4">
          {!jobs.length && (
            <Notice
              text={
                page === 0
                  ? "You have not posted any jobs yet."
                  : "No more job posts."
              }
            />
          )}
          {jobs.map((job) => (
            <JobProposalCard
              key={job.id}
              job={job}
              onView={() => router.push(`/proposals/${job.id}`)}
            />
          ))}
        </section>
      )}
      <PagerNav
        label="Job posts pages"
        page={page}
        hasMore={Boolean(data?.hasMore)}
        busy={isFetching}
        onPage={setPage}
      />
    </>
  );
}

function JobProposals({ jobId }: { jobId: string }) {
  const router = useRouter();
  const jobQuery = useJob(jobId);
  const [filter, setFilter] = useState<string>("All");
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);

  const proposalsQuery = useJobProposals(jobId, page);
  const markViewed = useMarkProposalViewed();
  const shortlist = useShortlistProposal();
  const startInterview = useStartInterview();
  const checkout = useContractCheckout();

  const proposals = useMemo(
    () => toProposalViews(proposalsQuery.data?.results ?? [], countryName),
    [proposalsQuery.data],
  );
  const visibleProposals = proposals.filter((proposal) =>
    matchesFilter(proposal, filter),
  );
  const selectedProposal =
    proposals.find((proposal) => proposal.id === selectedId) ?? null;
  const interviewProposal =
    proposals.find((proposal) => proposal.id === interviewId) ?? null;
  const contractProposal =
    proposals.find((proposal) => proposal.id === contractId) ?? null;

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const job = jobQuery.data;

  if (jobQuery.isLoading) return <PageSkeleton />;
  if (!job) {
    return (
      <>
        <BackLink />
        <div className="mt-6">
          <Notice
            text={
              isJobNotFound(jobQuery.error)
                ? "Job post not found."
                : jobErrorMessage(jobQuery.error)
            }
          />
        </div>
      </>
    );
  }

  const handleView = (proposal: ProposalView) => {
    setSelectedId(proposal.id);
    if (proposal.status !== "SUBMITTED") return;
    markViewed.mutate(proposal.id, {
      onError: (error) => {
        console.error(
          "Proposal view status update failed.",
          proposalErrorMessage(error),
        );
      },
    });
  };

  const handleShortlist = (proposal: ProposalView) => {
    shortlist.mutate(proposal.id, {
      onSuccess: () => setNotice("Proposal shortlisted."),
      onError: (error) => setNotice(proposalErrorMessage(error)),
    });
  };

  const handleInterview = (proposal: ProposalView) => {
    if (hasInterview(proposal) && proposal.conversationId) {
      router.push(messagesHref(proposal.conversationId));
      return;
    }
    setSelectedId(null);
    setInterviewId(proposal.id);
  };

  const handleHire = (proposal: ProposalView) => {
    setSelectedId(null);
    setContractId(proposal.id);
  };

  const submitInterview = async (message: string) => {
    if (!interviewProposal) return;
    const result = await startInterview.mutateAsync({
      proposalId: interviewProposal.id,
      message,
    });
    setInterviewId(null);
    router.push(messagesHref(result.conversationId));
  };

  const startContractCheckout = async (proposal: ProposalView) => {
    const result = await checkout.mutateAsync(proposal.id);
    if (!isHttpsUrl(result.url)) {
      throw new Error("Checkout returned an invalid address.");
    }
    window.location.assign(result.url);
  };

  return (
    <>
      <BackLink />

      <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
            Proposal review
          </p>
          <h1 className="mt-2 max-w-4xl text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
            {job.title}
          </h1>
          <p className="mt-2 text-sm text-[#72776f]">
            Compare every freelancer and agency that applied to this job.
          </p>
        </div>
        {job.hireCount > 0 ? (
          <Link
            href="/contracts"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold"
          >
            <Icon icon="solar:case-round-linear" width="17" />
            View contract
          </Link>
        ) : (
          !isJobLocked(job.status) && (
            <Link
              href={`/jobs/${job.id}/edit`}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold"
            >
              <Icon icon="solar:pen-2-linear" width="17" />
              Edit job post
            </Link>
          )
        )}
      </div>

      <section className="mt-6 rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <JobMetric
            label="Fixed budget"
            value={formatCents(job.totalBudgetCents)}
          />
          <JobMetric label="Proposals" value={String(job.proposalCount)} />
          <JobMetric label="Shortlisted" value={String(job.shortlistCount)} />
          <JobMetric label="Hires" value={String(job.hireCount)} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-black/7 pt-5">
          {job.skills.map((skill) => (
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
          {PROPOSAL_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-semibold ${
                filter === item
                  ? "bg-[#edf4ea] text-[#4e774b]"
                  : "bg-white text-[#6f756d] hover:bg-black/3"
              }`}
            >
              {item}
              <span className="text-[9px] opacity-65">
                {countByFilter(proposals, item)}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-[#858a82]">
          {visibleProposals.length
            ? `Showing ${visibleProposals.length} of ${proposals.length} proposals on this page`
            : "No proposals shown"}
        </p>
      </div>

      <div className="mt-5 grid gap-4">
        {proposalsQuery.isLoading ? (
          <ProposalSkeleton />
        ) : proposalsQuery.error ? (
          <Notice text={proposalErrorMessage(proposalsQuery.error)} />
        ) : visibleProposals.length ? (
          visibleProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              shortlisting={
                shortlist.isPending && shortlist.variables === proposal.id
              }
              onView={() => handleView(proposal)}
              onShortlist={() => handleShortlist(proposal)}
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
              Choose another status, change the page or return to your job
              posts.
            </p>
          </div>
        )}
      </div>

      <PagerNav
        label="Proposals pagination"
        page={page}
        hasMore={Boolean(proposalsQuery.data?.hasMore)}
        busy={proposalsQuery.isFetching}
        onPage={setPage}
      />

      {selectedProposal && (
        <ProposalDrawer
          proposal={selectedProposal}
          milestones={job.milestones}
          onClose={() => setSelectedId(null)}
          onInterview={() => handleInterview(selectedProposal)}
          onHire={() => handleHire(selectedProposal)}
        />
      )}

      {interviewProposal && (
        <StartInterviewModal
          proposal={interviewProposal}
          onClose={() => setInterviewId(null)}
          onSubmit={submitInterview}
        />
      )}

      {contractProposal && (
        <FundContractModal
          proposal={contractProposal}
          milestones={job.milestones}
          onClose={() => setContractId(null)}
          onPay={() => startContractCheckout(contractProposal)}
        />
      )}
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/proposals"
      className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#52784f]"
    >
      <Icon icon="solar:arrow-left-linear" width="15" />
      Back to job posts
    </Link>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-black/8 bg-white p-6 text-sm text-[#6f756d]">
      {text}
    </p>
  );
}

function PageSkeleton() {
  return (
    <div className="mt-8 animate-pulse rounded-2xl border border-black/8 bg-white p-6">
      <div className="h-3 w-20 rounded bg-[#e8ebe6]" />
      <div className="mt-4 h-5 w-72 max-w-full rounded bg-[#dde2db]" />
      <div className="mt-3 h-3 w-48 rounded bg-[#ecefeb]" />
      <div className="mt-6 h-3 w-full rounded bg-[#e8ebe6]" />
      <div className="mt-3 h-3 w-3/4 rounded bg-[#eef0ec]" />
    </div>
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
  job: JobPost;
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
                  isJobOpen(job.status)
                    ? "bg-[#e7f2e4] text-[#4d784a]"
                    : job.status === "DRAFT"
                      ? "bg-[#f1f0e7] text-[#766f47]"
                      : "bg-[#f0f1ef] text-[#767b74]"
                }`}
              >
                {jobStatusLabel(job.status)}
              </span>
              <span className="text-[10px] text-[#8a8f87]">
                {relativeTime(job.createdAt, "Recently")}
              </span>
            </div>
            <h2 className="mt-3 text-lg font-semibold">{job.title}</h2>
            <p className="mt-2 text-xs text-[#757b73]">
              Fixed price · {formatCents(job.totalBudgetCents)} ·{" "}
              {job.expertiseLevel} · {job.expectedDuration}
            </p>
            <p className="mt-4 line-clamp-2 max-w-4xl text-sm leading-6 text-[#6f756d]">
              {job.description}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:min-w-72">
            <JobMetric label="Proposals" value={String(job.proposalCount)} />
            <JobMetric label="Shortlisted" value={String(job.shortlistCount)} />
            <JobMetric label="Hires" value={String(job.hireCount)} />
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
          {job.proposalCount
            ? `${job.proposalCount} people and agencies applied`
            : "No proposals received yet"}
        </p>
        <button
          type="button"
          disabled={job.proposalCount === 0}
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
  shortlisting,
  onView,
  onShortlist,
}: {
  proposal: ProposalView;
  shortlisting: boolean;
  onView: () => void;
  onShortlist: () => void;
}) {
  const href = profileHref(proposal);
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
              {proposal.location} · Submitted{" "}
              {relativeTime(proposal.submittedAt, "recently")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-left sm:grid-cols-4 lg:text-right">
          <Mini label="Bid" value={formatCents(proposal.bidCents)} />
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
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[#edf4ea] px-3 py-1.5 text-[10px] font-semibold text-[#4e774b]">
            {proposal.statusLabel}
          </span>
          {proposal.isShortlisted && (
            <span className="rounded-full bg-[#f1f0e7] px-3 py-1.5 text-[10px] font-semibold text-[#766f47]">
              Shortlisted
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-black/10 px-4 py-3 text-xs font-semibold"
            >
              View profile
              <Icon icon="solar:arrow-right-up-linear" width="14" />
            </a>
          )}
          <button
            type="button"
            onClick={onView}
            className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
          >
            View proposal
          </button>
          {!proposal.isShortlisted && (
            <button
              type="button"
              disabled={shortlisting}
              onClick={onShortlist}
              className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {shortlisting ? "Shortlisting..." : "Shortlist"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function ProposalDrawer({
  proposal,
  milestones,
  onClose,
  onInterview,
  onHire,
}: {
  proposal: ProposalView;
  milestones: JobPost["milestones"];
  onClose: () => void;
  onInterview: () => void;
  onHire: () => void;
}) {
  const href = profileHref(proposal);
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
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon icon="solar:close-circle-linear" width="24" />
          </button>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            ["Bid", formatCents(proposal.bidCents)],
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
          <h3 className="text-sm font-semibold">Job milestones</h3>
          <div className="mt-3 divide-y divide-black/6 rounded-xl border border-black/7">
            {milestones.map((item) => (
              <div key={item.id} className="flex justify-between gap-4 p-4">
                <div>
                  <p className="text-xs font-semibold">{item.title}</p>
                  <p className="mt-1 text-[10px] text-[#858a82]">
                    {item.dueDate}
                  </p>
                </div>
                <p className="text-xs font-semibold">
                  {formatCents(item.budgetCents)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {!!proposal.screeningAnswers.length && (
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
        {href && (
          <a
            href={href}
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
        )}
        <div className="mt-7 flex flex-wrap justify-end gap-2">
          {canStartInterview(proposal) && (
            <button
              type="button"
              onClick={onInterview}
              className="h-11 rounded-xl border border-black/10 px-4 text-xs font-semibold"
            >
              {hasInterview(proposal) ? "Go to interview" : "Start interview"}
            </button>
          )}
          {proposal.contractId ? (
            <Link
              href={`/contracts?contractId=${proposal.contractId}`}
              className="inline-flex h-11 items-center rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white"
            >
              See contract
            </Link>
          ) : (
            canSendOffer(proposal) && (
              <button
                type="button"
                onClick={onHire}
                className="h-11 rounded-xl bg-[#252724] px-5 text-xs font-semibold text-white"
              >
                Send contract offer
              </button>
            )
          )}
        </div>
      </aside>
    </div>
  );
}

function FundContractModal({
  proposal,
  milestones,
  onClose,
  onPay,
}: {
  proposal: ProposalView;
  milestones: JobPost["milestones"];
  onClose: () => void;
  onPay: () => Promise<void>;
}) {
  const milestone = milestones[0];
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState("");

  const handlePay = async () => {
    setIsPaying(true);
    setError("");
    try {
      await onPay();
    } catch (payError) {
      setError(
        payError instanceof Error && payError.message.startsWith("Checkout")
          ? payError.message
          : proposalErrorMessage(payError),
      );
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
              Fund the first milestone before sending the contract to{" "}
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
                    Due {milestone.dueDate}
                  </p>
                </div>
                <strong className="text-lg">
                  {formatCents(milestone.budgetCents)}
                </strong>
              </div>
            </div>

            <div className="mt-5 grid gap-3 border-y border-black/7 py-4 text-sm">
              <div className="flex items-center justify-between text-[#6d736b]">
                <span>Milestone funding</span>
                <span>{formatCents(milestone.budgetCents)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold">
                <span>Amount due today</span>
                <span>{formatCents(milestone.budgetCents)}</span>
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

        {error && (
          <p role="alert" className="mt-4 text-xs text-red-600">
            {error}
          </p>
        )}

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
  proposal: ProposalView;
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
            setError(proposalErrorMessage(submitError));
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
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" width="24" />
          </button>
        </div>
        <textarea
          autoFocus
          required
          maxLength={INTERVIEW_MESSAGE_MAX}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Hi, I reviewed your proposal and would like to discuss..."
          className="mt-5 min-h-36 w-full resize-y rounded-xl border border-black/10 p-4 text-sm outline-none focus:border-[#62805f]"
        />
        {error && (
          <p role="alert" className="mt-2 text-xs text-[#9a5a5a]">
            {error}
          </p>
        )}
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
