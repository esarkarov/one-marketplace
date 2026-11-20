"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Icon } from "../ui/icon";
import type { AgencyMemberRole, PendingInvitation } from "./types";

export function InviteMemberModal({
  agencyName,
  onClose,
  onInvited,
}: {
  agencyName: string;
  onClose: () => void;
  onInvited: (invitation: PendingInvitation) => void;
}) {
  const { getToken } = useAuth();
  const [complete, setComplete] = useState(false);
  const [notifiedInApp, setNotifiedInApp] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<AgencyMemberRole, "Agency owner">>(
    "Agency member",
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const invite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/team/invitations?role=freelancer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, memberRole: role }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);

      onInvited({
        kind: "invitation",
        id: result.data.id,
        email: result.data.email,
        avatarUrl: result.data.avatarUrl,
        role: result.data.role,
        createdAt: result.data.createdAt,
      });
      setNotifiedInApp(Boolean(result.data.notifiedInApp));
      setComplete(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The invitation could not be sent.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (complete) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/45 p-5 backdrop-blur-[2px]"
      >
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e6f2e3] text-[#4d784a]">
            <Icon name="team" size={29} />
          </span>
          <h2 className="mt-5 text-xl font-semibold">Invitation sent</h2>
          <p className="mt-2 text-sm leading-6 text-[#737870]">
            {email} was invited to join {agencyName}.{" "}
            {notifiedInApp
              ? "They've been notified in their dashboard and can accept it from there."
              : "We couldn't find an existing freelancer account for that email yet — they'll see the invitation as soon as they sign up with it."}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 h-11 w-full cursor-pointer rounded-xl bg-[#252724] text-sm font-semibold text-white"
          >
            Back to team
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
      className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/45 p-5 backdrop-blur-[2px]"
    >
      <form
        onSubmit={invite}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#62805f] uppercase">
              Agency membership
            </p>
            <h2 id="invite-title" className="mt-2 text-xl font-semibold">
              Invite a freelancer
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer"
          >
            <Icon name="close" size={25} />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-[#737870]">
          Invited freelancers keep their personal accounts and choose whether
          to join your agency.
        </p>
        <label className="mt-5 block text-xs font-semibold">
          Email address
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="freelancer@example.com"
            className="mt-2 h-11 w-full rounded-xl border border-black/10 px-3 text-sm font-normal outline-none focus:border-[#6e916a]"
          />
        </label>
        <label className="mt-4 block text-xs font-semibold">
          Agency account role
          <select
            value={role}
            onChange={(event) =>
              setRole(event.target.value as "Business manager" | "Agency member")
            }
            className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-normal outline-none"
          >
            <option>Agency member</option>
            <option>Business manager</option>
          </select>
        </label>
        <div className="mt-4 rounded-xl bg-[#f3f5f1] p-4 text-xs leading-5 text-[#70766e]">
          Agency members appear on the public roster after accepting and
          completing their profile. This does not assign them to client work.
        </div>
        {error && <p className="mt-3 text-xs text-[#a65050]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 cursor-pointer rounded-xl border border-black/10 px-5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </form>
    </div>
  );
}
