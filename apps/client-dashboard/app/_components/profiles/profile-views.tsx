"use client";

import {
  isProfileNotFound,
  profileErrorMessage,
  useAgencyProfile,
  useTalentProfile,
} from "@onemarketplace/web-core";
import Link from "next/link";
import { PublicAgencyProfile } from "./public-agency-profile";
import { PublicMarketplaceProfile } from "./public-marketplace-profile";

function ProfileState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-10 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {detail && <p className="mt-2 text-sm text-[#72776f]">{detail}</p>}
      <Link
        href="/proposals"
        className="mt-5 inline-flex text-xs font-semibold text-[#52784f]"
      >
        Back to proposals
      </Link>
    </div>
  );
}

export function TalentProfileView({ id }: { id: string }) {
  const { data, error, isPending } = useTalentProfile(id);
  if (isPending) return <ProfileState title="Loading profile…" />;
  if (error) {
    return isProfileNotFound(error) ? (
      <ProfileState title="Talent profile not found." />
    ) : (
      <ProfileState
        title="This profile could not be loaded."
        detail={profileErrorMessage(error)}
      />
    );
  }
  return <PublicMarketplaceProfile profile={data} />;
}

export function AgencyProfileView({ id }: { id: string }) {
  const { data, error, isPending } = useAgencyProfile(id);
  if (isPending) return <ProfileState title="Loading profile…" />;
  if (error) {
    return isProfileNotFound(error) ? (
      <ProfileState title="Agency profile not found." />
    ) : (
      <ProfileState
        title="This profile could not be loaded."
        detail={profileErrorMessage(error)}
      />
    );
  }
  return <PublicAgencyProfile agency={data} />;
}
