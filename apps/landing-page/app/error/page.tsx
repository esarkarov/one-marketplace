import Link from "next/link";
import React from "react";

const errorMessages: Record<string, string> = {
  missing_signup_details:
    "Your signup link is incomplete. Please start the signup process again.",
  invalid_role: "The selected account type is not supported.",
  authentication_unavailable:
    "Authentication is temporarily unavailable. Please try again shortly.",
  role_mismatch:
    "The account type does not match your signup session. Please start again.",
  backend_signup_failed:
    "We authenticated your account but could not finish setting it up.",
  invalid_or_expired_token:
    "Your authentication session is invalid or has expired. Please sign up again.",
  account_not_registered:
    "We couldn't find an account for that sign-in. If you're new here, please sign up first.",
};

interface ErrorPageProps {
  searchParams: Promise<{ reason?: string }>;
}

const Page = async ({ searchParams }: ErrorPageProps) => {
  const { reason } = await searchParams;
  const message = errorMessages[reason ?? ""] ?? "";

  return (
    <main className="grid min-h-screen place-items-center bg-[#fbfcfa] px-6">
      <section className="w-full max-w-md rounded-3xl border border-black/8 bg-white p-8 text-center shadow-[0_24px_70px_rgba(31,38,29,0.08)]">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0ee] text-xl text-[#a04f47]">
          !
        </span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-[#20231f]">
          We couldn’t finish signup
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#747970]">{message}</p>
        <Link
          href="/signup"
          className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#252724] text-sm font-semibold text-white! transition hover:bg-[#3b3e39]"
        >
          Return to signup
        </Link>
      </section>
    </main>
  );
};

export default Page;
