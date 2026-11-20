"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { Icon } from "@iconify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "timeago.js";
import { useState } from "react";
import { DashboardHeader } from "../_components/dashboard/dashboard-header";
import { WorkspaceSidebar } from "../_components/dashboard/workspace-sidebar";

type AgencyInvitation = {
  id: string;
  agencyId: string;
  agencyName: string;
  agencyAvatar: { imageId: string; url: string } | null;
  role: string;
  createdAt: string;
};

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

export function AgencyInvitationsDashboard() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const { data: invitations = [], isLoading } = useQuery<AgencyInvitation[]>({
    queryKey: ["my-agency-invitations"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/invitations/mine?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });

  const respond = async (invitation: AgencyInvitation, accept: boolean) => {
    if (respondingId) return;
    setRespondingId(invitation.id);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/invitations/${invitation.id}/respond?role=freelancer`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ accept }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);

      setNotice(
        accept
          ? `You joined ${invitation.agencyName}. Head to the agency dashboard to get started.`
          : `You declined the invitation from ${invitation.agencyName}.`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["my-agency-invitations"],
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The invitation could not be updated.",
      );
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="min-h-svh bg-[#f4f6f2] font-(family-name:--font-dm-sans) text-[#242724]">
      <DashboardHeader />
      <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
        <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
          <WorkspaceSidebar />

          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#62805f] uppercase">
              Agency membership
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              Agency invitations
            </h1>
            <p className="mt-2 text-sm text-[#72776f]">
              Review invitations to join an agency team. You keep your
              personal freelancer account either way.
            </p>

            {notice && (
              <div className="mt-5 flex items-center justify-between rounded-xl border border-[#cfdfcb] bg-[#edf4ea] px-4 py-3 text-xs font-medium text-[#4e774b]">
                <span className="inline-flex items-center gap-2">
                  <Icon icon="solar:check-circle-bold" width="17" /> {notice}
                </span>
                <button
                  type="button"
                  onClick={() => setNotice("")}
                  aria-label="Dismiss"
                  className="cursor-pointer"
                >
                  <Icon icon="solar:close-circle-linear" width="18" />
                </button>
              </div>
            )}
            {error && (
              <p className="mt-5 text-sm text-[#a65050]">{error}</p>
            )}

            <div className="mt-6 grid gap-4">
              {isLoading && (
                <div className="animate-pulse rounded-2xl border border-black/8 bg-white p-6">
                  <div className="h-5 w-40 rounded bg-[#e8ebe6]" />
                  <div className="mt-4 h-4 w-64 rounded bg-[#e8ebe6]" />
                </div>
              )}
              {!isLoading &&
                invitations.map((invitation) => (
                  <article
                    key={invitation.id}
                    className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6"
                  >
                    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#496e67] text-sm font-semibold text-white">
                          {invitation.agencyAvatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={invitation.agencyAvatar.url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            getInitials(invitation.agencyName)
                          )}
                        </span>
                        <div className="min-w-0">
                          <h2 className="truncate font-semibold">
                            {invitation.agencyName}
                          </h2>
                          <p className="mt-1 text-xs text-[#7b8078]">
                            Invited you as {invitation.role} ·{" "}
                            {format(invitation.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={respondingId === invitation.id}
                          onClick={() => void respond(invitation, false)}
                          className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold hover:bg-black/3 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          disabled={respondingId === invitation.id}
                          onClick={() => void respond(invitation, true)}
                          className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {respondingId === invitation.id
                            ? "Accepting…"
                            : "Accept invitation"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              {!isLoading && !invitations.length && (
                <div className="rounded-2xl border border-black/8 bg-white px-6 py-16 text-center">
                  <Icon
                    icon="solar:letter-linear"
                    width="34"
                    className="mx-auto text-[#858a82]"
                  />
                  <h2 className="mt-4 font-semibold">No pending invitations</h2>
                  <p className="mt-2 text-sm text-[#7c8179]">
                    You don't have any agency invitations waiting right now.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
