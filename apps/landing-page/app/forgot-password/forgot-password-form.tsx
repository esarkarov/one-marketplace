"use client";

import Link from "next/link";
import { SubmitEvent, useState } from "react";
import styles from "../signup/signup.module.css";
import { useSignIn } from "@clerk/nextjs";

export function ForgotPasswordForm() {
  const { signIn, fetchStatus } = useSignIn();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password" | "done">(
    "email",
  );

  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const isLoading = fetchStatus === "fetching";

  async function sendCode(address: string) {
    if (!signIn) return;

    const { error: createError } = await signIn.create({
      identifier: address,
    });
    if (createError) throw createError;

    const { error } = await signIn.resetPasswordEmailCode.sendCode();
    if (error) throw error;
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const address = String(formData.get("email") ?? "").trim();
    setStatus("");
    setIsError(false);

    try {
      await sendCode(address);
      setEmail(address);
      setStep("code");
    } catch (error) {
      setIsError(true);
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to send the reset code.",
      );
    }
  }

  async function handleResend() {
    setStatus("");
    setIsError(false);

    try {
      await signIn?.resetPasswordEmailCode.sendCode();
      setStatus("A new verification code has been sent.");
    } catch (error) {
      setIsError(true);
      setStatus(
        error instanceof Error ? error.message : "Unable to resend the code.",
      );
    }
  }

  async function handleCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsError(false);

    const code = String(
      new FormData(event.currentTarget).get("code") ?? "",
    ).trim();

    const { error } = await signIn!.resetPasswordEmailCode.verifyCode({ code });

    if (error) {
      setIsError(true);
      setStatus(error.message);
      return;
    }

    setStep("password");
  }

  async function handlePassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsError(false);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    if (password !== confirmation) {
      setIsError(true);
      setStatus("Passwords do not match.");
      return;
    }

    const { error } = await signIn!.resetPasswordEmailCode.submitPassword({
      password,
      signOutOfOtherSessions: true,
    });

    if (error) {
      setIsError(true);
      setStatus(error.message);
      return;
    }

    setStep("done");
  }

  if (step !== "email") {
    const isDone = step === "done";

    return (
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e5f2e2] text-[#477244]">
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3.5"
              y="5.5"
              width="17"
              height="13"
              rx="3"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="m5.5 8 5.1 4a2.3 2.3 0 0 0 2.8 0l5.1-4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className={`${styles.formTitle} mt-6 text-[#171916]`}>
          {isDone
            ? "Password updated"
            : step === "password"
              ? "Create a new password"
              : "Check your email"}
        </h1>

        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#72766f]">
          {isDone ? (
            "Your password has been reseted successully."
          ) : step === "password" ? (
            "Choose a secure password for your account."
          ) : (
            <>
              Enter the verification code sent to{" "}
              <strong className="text-[#392c37]">{email}</strong>
            </>
          )}
        </p>

        {!isDone && (
          <form
            className="mt-8 grid gap-4 text-left"
            onSubmit={step === "code" ? handleCode : handlePassword}
          >
            {step === "code" ? (
              <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
                Verification code
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  className="h-12 rounded-xl border border-black/13 bg-white px-4 font-normal outline-none focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
                  placeholder="Enter your code"
                />
              </label>
            ) : (
              <>
                <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
                  New password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    autoFocus
                    className="h-12 rounded-xl border border-black/13 bg-white px-4 font-normal outline-none focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
                  Confirm password
                  <input
                    name="confirmation"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    autoFocus
                    className="h-12 rounded-xl border border-black/13 bg-white px-4 font-normal outline-none focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
                  />
                </label>
              </>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="h-12 cursor-pointer rounded-xl bg-[#252724] text-sm font-semibold text-white disabled:opacity-50"
            >
              {isLoading
                ? "Please wait…"
                : step === "code"
                  ? "Verify code"
                  : "Reset password"}
            </button>
          </form>
        )}

        {status && (
          <p
            className={`rounded-xl bg-[#edf5eb] px-4 py-3 text-center text-xs font-medium text-[#4e704b]
              ${
                isError
                  ? "bg-[#fff0ee] text-[#914d45]"
                  : "bg-[#edf5eb] text-[#3e704b]"
              }
              `}
            role={isError ? "alert" : "status"}
          >
            {status}
          </p>
        )}

        {step === "code" && (
          <div className="mt-4 flex justify-center gap-4 text-sm font-semibold text-[#477445]">
            <button
              type="button"
              onClick={() => void handleResend()}
              className="cursor-pointer hover:underline"
            >
              Resend code
            </button>
            <button
              type="button"
              onClick={() => setStep("email")}
              className="cursor-pointer hover:underline"
            >
              Change email
            </button>
          </div>
        )}

        <Link
          href="/login"
          className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-[#477445] hover:underline!"
        >
          <span aria-hidden="true">←</span>
          {isDone ? "Continue to login" : "Back to login"}
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md text-left">
      <Link
        href="/login"
        className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-[#5e625c] transition hover:text-[#252724]"
      >
        <span aria-hidden="true">←</span>
        Back to login
      </Link>

      <div className="text-center">
        <span className="inline-flex rounded-full bg-[#e9f4e6] px-3 py-1.5 text-xs font-semibold text-[#4f754d]">
          Account recovery
        </span>
        <h1 className={`${styles.formTitle} mt-4 text-[#171916]`}>
          Forgot your password?
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#72766f]">
          Enter the email associated with your account and we’ll send you a
          secure reset link.
        </p>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={email}
            required
            autoFocus
            className="h-12 rounded-xl border border-black/13 bg-white px-4 font-normal outline-none transition placeholder:text-[#a2a59f] focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
            placeholder="you@example.com"
          />
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="h-12 w-full cursor-pointer rounded-xl bg-[#252724] text-sm font-semibold text-white shadow-sm transition hover:bg-[#3b3e39] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4c7849]"
        >
          {isLoading ? "Sending…" : "Send reset code"}
        </button>
      </form>

      {status && (
        <p
          className="mt-4 rounded-xl bg-[#fff0ee] px-4 py-3 text-center text-xs font-medium text-[#9a4d45]"
          role="alert"
        >
          {status}
        </p>
      )}

      <p className="mt-7 text-center text-sm text-[#555952]">
        Don’t have an account?{" "}
        <Link
          href="/signup"
          className="font-semibold text-[#397236] hover:underline!"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
