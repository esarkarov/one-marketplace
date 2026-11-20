"use client";

import { useMemo, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AgencyShell } from "../_components/dashboard/agency-shell";
import { InviteMemberModal } from "../_components/team/invite-member-modal";
import { MemberCard } from "../_components/team/member-card";
import { MemberDrawer } from "../_components/team/member-drawer";
import type {
  ActiveTeamMember,
  PendingInvitation,
  TeamRow,
} from "../_components/team/types";
import { Icon } from "../_components/ui/icon";

const filters = ["All members", "Active", "Invitation pending"] as const;

type AgencyMineMember = {
  id: string;
  freelancerId: string;
  profileId: string | null;
  name: string;
  avatarUrl: string | null;
  role: string;
  skills: string[];
  isOwner: boolean;
  rating: number;
  jobSuccessScore: number;
  completedProjects: number;
};

type ApiInvitation = {
  id: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  createdAt: string;
};

export function TeamDashboard() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<(typeof filters)[number]>("All members");
  const [role, setRole] = useState("All roles");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TeamRow | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamRow | null>(null);
  const [notice, setNotice] = useState("");

  const { data: agency, isLoading: agencyLoading } = useQuery({
    queryKey: ["agency-mine"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data as {
        name: string;
        members: AgencyMineMember[];
      } | null;
    },
  });

  const { data: invitationData, isLoading: invitationsLoading } = useQuery({
    queryKey: ["agency-team-invitations"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/team/invitations?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data as ApiInvitation[];
    },
  });

  const agencyName = agency?.name ?? "your agency";
  const isLoading = agencyLoading || invitationsLoading;

  const members: ActiveTeamMember[] = useMemo(
    () =>
      (agency?.members ?? []).map((member) => ({
        kind: "member",
        id: member.id,
        freelancerId: member.freelancerId,
        profileId: member.profileId,
        name: member.name,
        avatarUrl: member.avatarUrl,
        role: member.isOwner ? "Agency owner" : (member.role as "Business manager" | "Agency member"),
        skills: member.skills,
        isOwner: member.isOwner,
        rating: member.rating,
        jobSuccessScore: member.jobSuccessScore,
        completedProjects: member.completedProjects,
      })),
    [agency],
  );

  const invitations: PendingInvitation[] = useMemo(
    () =>
      (invitationData ?? []).map((invitation) => ({
        kind: "invitation",
        id: invitation.id,
        email: invitation.email,
        avatarUrl: invitation.avatarUrl,
        role: invitation.role as "Business manager" | "Agency member",
        createdAt: invitation.createdAt,
      })),
    [invitationData],
  );

  const rows: TeamRow[] = useMemo(
    () => [...members, ...invitations],
    [members, invitations],
  );

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "Active" && row.kind !== "member") return false;
      if (filter === "Invitation pending" && row.kind !== "invitation")
        return false;
      if (role !== "All roles" && row.role !== role) return false;
      if (!query) return true;
      const name = row.kind === "member" ? row.name : row.email;
      const haystack =
        row.kind === "member"
          ? `${name} ${row.skills.join(" ")}`
          : `${name} ${row.email}`;
      return haystack.toLowerCase().includes(query);
    });
  }, [filter, role, rows, search]);

  const authHeaders = async () => {
    const token = await getToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  };

  const refreshTeam = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agency-mine"] }),
      queryClient.invalidateQueries({ queryKey: ["agency-team-invitations"] }),
    ]);

  const updateRole = async (
    row: TeamRow,
    nextRole: "Business manager" | "Agency member",
  ) => {
    const path =
      row.kind === "member"
        ? `/agency/team/members/${row.id}`
        : `/agency/team/invitations/${row.id}`;
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}${path}?role=freelancer`,
      {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ memberRole: nextRole }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.message || "The role could not be updated.");
      return;
    }
    await refreshTeam();
    const name = row.kind === "member" ? row.name : row.email;
    setNotice(`${name}'s agency role was updated.`);
    setSelected(null);
  };

  const resendInvitation = async (row: PendingInvitation) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/team/invitations/${row.id}/resend?role=freelancer`,
      { method: "POST", headers: await authHeaders() },
    );
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.message || "The invitation could not be resent.");
      return;
    }
    setNotice(
      result.data?.notifiedInApp
        ? `Invitation resent to ${row.email}.`
        : `Invitation resent to ${row.email}. No account exists for that email yet.`,
    );
  };

  const removeRow = async () => {
    if (!removeTarget) return;
    const path =
      removeTarget.kind === "member"
        ? `/agency/team/members/${removeTarget.id}`
        : `/agency/team/invitations/${removeTarget.id}`;
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}${path}?role=freelancer`,
      { method: "DELETE", headers: await authHeaders() },
    );
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.message || "This could not be removed.");
      setRemoveTarget(null);
      return;
    }
    await refreshTeam();
    const name =
      removeTarget.kind === "member" ? removeTarget.name : removeTarget.email;
    setNotice(
      removeTarget.kind === "invitation"
        ? `Invitation for ${name} was cancelled.`
        : `${name} was removed from the agency.`,
    );
    setSelected(null);
    setRemoveTarget(null);
  };

  return (
    <AgencyShell>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-[#62805f] uppercase">
            Agency membership
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
            Agency team
          </h1>
          <p className="mt-2 text-sm text-[#72776f]">
            Manage the freelancers displayed on your agency profile and their
            account permissions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white"
        >
          <Icon name="plus" size={18} /> Invite freelancer
        </button>
      </div>

      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Total members", members.length, "team", "bg-[#e7f2e4] text-[#4d784a]"],
          [
            "Business managers",
            members.filter((member) => member.role === "Business manager")
              .length,
            "settings",
            "bg-[#e8eff4] text-[#4c6e86]",
          ],
          [
            "Pending invites",
            invitations.length,
            "message",
            "bg-[#eeeaf5] text-[#6b5d82]",
          ],
          [
            "Avg. job success",
            (() => {
              // A member with no completed projects has no real job success
              // score yet — averaging in their 0 would drag the team's
              // number down for reasons that have nothing to do with actual
              // performance, so only members with completed work count.
              const rated = members.filter((m) => m.completedProjects > 0);
              return rated.length
                ? `${Math.round(
                    rated.reduce((sum, m) => sum + m.jobSuccessScore, 0) /
                      rated.length,
                  )}%`
                : "—";
            })(),
            "verified",
            "bg-[#f1f0e6] text-[#766f47]",
          ],
        ].map(([label, value, icon, color]) => (
          <div
            key={String(label)}
            className="flex items-center gap-4 rounded-2xl border border-black/8 bg-white p-5"
          >
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${color}`}
            >
              <Icon name={icon as "team"} size={22} />
            </span>
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em]">
                {value}
              </p>
              <p className="mt-0.5 text-xs text-[#7c8179]">{label}</p>
            </div>
          </div>
        ))}
      </section>

      {notice && (
        <div className="mt-5 flex items-center justify-between rounded-xl border border-[#cfdfcb] bg-[#edf4ea] px-4 py-3 text-xs font-medium text-[#4e774b]">
          <span className="inline-flex items-center gap-2">
            <Icon name="verified" size={17} /> {notice}
          </span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss"
            className="cursor-pointer"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-black/8 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`shrink-0 cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold ${
                filter === item
                  ? "bg-[#edf4ea] text-[#4e774b]"
                  : "text-[#747971] hover:bg-black/3"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="h-10 rounded-xl border border-black/9 bg-white px-3 text-xs font-semibold outline-none"
          >
            <option>All roles</option>
            <option>Agency owner</option>
            <option>Business manager</option>
            <option>Agency member</option>
          </select>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-black/9 px-3 sm:w-72">
            <Icon name="search" size={18} className="text-[#7b8078]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search team members"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
        </div>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {isLoading &&
          Array.from({ length: 3 }, (_, index) => (
            <MemberCardSkeleton key={index} />
          ))}
        {!isLoading &&
          visibleRows.map((row) => (
            <MemberCard key={`${row.kind}-${row.id}`} row={row} onView={setSelected} />
          ))}
      </div>

      {!isLoading && !visibleRows.length && (
        <div className="mt-4 rounded-2xl border border-dashed border-black/12 bg-white px-6 py-16 text-center">
          <Icon name="team" size={35} className="mx-auto text-[#858a82]" />
          <h2 className="mt-4 font-semibold">No team members found</h2>
          <p className="mt-2 text-sm text-[#7c8179]">
            Try another role, status, or search term.
          </p>
        </div>
      )}

      {selected && (
        <MemberDrawer
          row={selected}
          onClose={() => setSelected(null)}
          onUpdateRole={(row, nextRole) => void updateRole(row, nextRole)}
          onRemove={setRemoveTarget}
          onResend={(row) => void resendInvitation(row as PendingInvitation)}
          onCancel={setRemoveTarget}
        />
      )}

      {inviteOpen && (
        <InviteMemberModal
          agencyName={agencyName}
          onClose={() => setInviteOpen(false)}
          onInvited={() => void refreshTeam()}
        />
      )}

      {removeTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/45 p-5 backdrop-blur-[2px]"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">
              {removeTarget.kind === "invitation"
                ? "Cancel this invitation?"
                : "Remove this agency member?"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#737870]">
              {removeTarget.kind === "invitation"
                ? `${removeTarget.email} will no longer be able to accept this invitation.`
                : `${removeTarget.name} will lose access to ${agencyName} and will no longer appear on its public roster. Their personal freelancer account will not be affected.`}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold"
              >
                Keep member
              </button>
              <button
                type="button"
                onClick={() => void removeRow()}
                className="h-10 cursor-pointer rounded-xl bg-[#8b5656] px-4 text-xs font-semibold text-white"
              >
                {removeTarget.kind === "invitation"
                  ? "Cancel invitation"
                  : "Remove member"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AgencyShell>
  );
}

function MemberCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse rounded-2xl border border-black/8 bg-white p-5"
    >
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 rounded-full bg-[#e8ebe6]" />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-2/3 rounded bg-[#e8ebe6]" />
          <div className="mt-2 h-3 w-1/2 rounded bg-[#eef1ec]" />
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <div className="h-5 w-20 rounded-full bg-[#eef1ec]" />
        <div className="h-3 w-16 rounded bg-[#eef1ec]" />
      </div>
      <div className="mt-5 flex gap-1.5">
        <div className="h-6 w-14 rounded-lg bg-[#eef1ec]" />
        <div className="h-6 w-14 rounded-lg bg-[#eef1ec]" />
        <div className="h-6 w-10 rounded-lg bg-[#eef1ec]" />
      </div>
      <div className="mt-5 h-10 w-full rounded-xl bg-[#f0f2ee]" />
    </div>
  );
}
