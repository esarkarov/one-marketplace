"use client";

import Link from "next/link";
import { SubmitEvent, useEffect, useState } from "react";
import { countries } from "./countries";
import styles from "./signup.module.css";
import { useAuth, useSignUp, useUser } from "@clerk/nextjs";

interface SignupFormProps {
  role: "client" | "freelancer";
}

export function SignupForm({ role }: SignupFormProps) {
  const { signUp, fetchStatus } = useSignUp();
  const { getToken } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const { user } = useUser();

  const isClient = role === "client";
  const isLoading = fetchStatus === "fetching";

  function goToBackendSync(sessionRole: unknown, token: string | null) {
    if (typeof sessionRole !== "string") {
      window.location.assign("/error?reason=account_not_registered");
      return;
    }
    if (!token) {
      window.location.assign("/error?reason=invalid_or_expired_token");
      return;
    }
    window.location.assign(
      `/api/sign-up?token=${encodeURIComponent(token)}&role=${encodeURIComponent(sessionRole)}`,
    );
  }

  useEffect(() => {
    if (!user) return;
    void (async () => {
      goToBackendSync(user.unsafeMetadata.role, await getToken());
    })();
  }, [getToken, user]);

  function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    if (error && typeof error === "object" && "message" in error) {
      return String(error.message);
    }

    return "We couldn't create account. Please check your details and try again.";
  }

  async function redirectWithSessionToken() {
    if (!signUp) {
      return;
    }

    const { error } = await signUp.finalize({
      navigate: async ({ session, decorateUrl }) => {
        const token = await session.getToken();

        if (!token) {
          throw new Error("Clerk did not return a session token.");
        }

        window.location.assign(
          decorateUrl(
            `/api/sign-up?token=${encodeURIComponent(token)}&role=${encodeURIComponent(role)}`,
          ),
        );
      },
    });

    if (error) {
      throw error;
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsError(false);

    if (!signUp) {
      setIsError(true);
      setStatus("Authentication is still loading. Please try again.");
      return;
    }

    const formData = new FormData(event?.currentTarget);
    const emailAddress = String(formData.get("email") ?? "");

    try {
      const { error } = await signUp.password({
        emailAddress,
        password: String(formData.get("password") ?? ""),
        firstName: String(formData.get("firstName") ?? ""),
        lastName: String(formData.get("lastName") ?? ""),
        legalAccepted: formData.get("terms") === "on",
        unsafeMetadata: {
          role,
          country: String(formData.get("country") ?? ""),
        },
      });

      if (error) {
        throw error;
      }

      if (signUp.status === "complete") {
        await redirectWithSessionToken();
        return;
      }

      const verification = await signUp.verifications.sendEmailCode();

      if (verification.error) {
        throw verification.error;
      }

      setPendingEmail(emailAddress);
      setIsVerifying(true);
      setStatus("We sent a six-digit verification code to your email.");
    } catch (error) {
      setIsError(true);
      setStatus(getErrorMessage(error));
    }
  }

  async function handleSocialSignup(provider: "Google" | "GitHub") {
    setStatus("");
    setIsError(false);

    if (!signUp) {
      setIsError(true);
      setStatus("Authentication is still loading. Please try again.");
      return;
    }

    try {
      const { error } = await signUp.sso({
        strategy: provider === "Google" ? "oauth_google" : "oauth_github",
        redirectUrl: `/auth/complete?role=${encodeURIComponent(role)}`,
        redirectCallbackUrl: `/signup?role=${role}`,
        unsafeMetadata: { role },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setIsError(true);
      setStatus(getErrorMessage(error));
    }
  }

  async function handleVerification(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsError(false);

    if (!signUp) {
      setIsError(true);
      setStatus("Authentication is still loading. Please try again.");
      return;
    }

    try {
      const { error } = await signUp.verifications.verifyEmailCode({
        code: verificationCode,
      });

      if (error) {
        throw error;
      }

      if (signUp.status !== "complete") {
        throw new Error("Your email was verified, but signup is not complete.");
      }

      await redirectWithSessionToken();
    } catch (error) {
      setIsError(true);
      setStatus(getErrorMessage(error));
    }
  }

  async function resendVerificationCode() {
    setStatus("");
    setIsError(false);

    if (!signUp) {
      return;
    }

    try {
      const { error } = await signUp.verifications.sendEmailCode();

      if (error) {
        setIsError(true);
        setStatus(getErrorMessage(error));
        return;
      }

      setStatus("A new verification code has been sent.");
    } catch (error) {
      setIsError(true);
      setStatus(getErrorMessage(error));
    }
  }

  if (isVerifying) {
    return (
      <div className="w-full max-w-md text-left">
        <button
          type="button"
          onClick={() => {
            void signUp?.reset();
            setIsVerifying(false);
            setVerificationCode("");
            setStatus("");
          }}
          className="mb-8 inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#5e625c] transition hover:text-[#252724]"
        >
          <span aria-hidden="true">←</span>
          Back to account details
        </button>

        <div className="text-center">
          <span className="inline-flex rounded-full bg-[#e9f4e6] px-3 py-1.5 text-xs font-semibold text-[#4f754d]">
            Verify your email
          </span>
          <h1 className={`${styles.formTitle} mt-4 text-[#171916]`}>
            Check your inbox
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#72766f]">
            Enter the six-digit code sent to{" "}
            <span className="font-semibold text-[#30332f]">{pendingEmail}</span>
            .
          </p>
        </div>

        <form onSubmit={handleVerification} className="mt-8 space-y-5">
          <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
            Verification code
            <input
              value={verificationCode}
              onChange={(event) =>
                setVerificationCode(event.target.value.replace(/\D/g, ""))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              minLength={6}
              maxLength={6}
              required
              autoFocus
              className="h-12 rounded-xl border border-black/13 bg-white px-4 text-center font-mono text-lg tracking-[0.35em] outline-none transition placeholder:text-[#a2a59f] focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
              placeholder="000000"
            />
          </label>

          <button
            type="submit"
            disabled={isLoading || verificationCode.length !== 6}
            className="h-12 w-full cursor-pointer rounded-xl bg-[#252724] text-sm font-semibold text-white shadow-sm transition hover:bg-[#3b3e39] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Verifying..." : "Verify and continue"}
          </button>

          <button
            type="button"
            onClick={() => void resendVerificationCode()}
            disabled={isLoading}
            className="w-full cursor-pointer text-center text-sm font-semibold text-[#497446] disabled:opacity-50"
          >
            Send a new code
          </button>

          {status && (
            <p
              className={`rounded-xl px-4 py-3 text-center text-xs font-medium ${
                isError
                  ? "bg-[#fff0ee] text-[#9a4d45]"
                  : "bg-[#edf5eb] text-[#4e704b]"
              }`}
              role={isError ? "alert" : "status"}
            >
              {status}
            </p>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md text-left">
      <Link
        href="/signup"
        className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-[#5e625c] transition hover:text-[#252724]"
      >
        <span aria-hidden="true">←</span>
        Change account type
      </Link>

      <div className="text-center">
        <span className="inline-flex rounded-full bg-[#e9f4e6] px-3 py-1.5 text-xs font-semibold text-[#4f754d]">
          {isClient ? "Client account" : "Freelancer account"}
        </span>
        <h1 className={`${styles.formTitle} mt-4 text-[#171916]`}>
          {isClient
            ? "Create your client account"
            : "Create your freelancer account"}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#72766f]">
          {isClient
            ? "Start hiring trusted independent professionals and agencies."
            : "Build your profile, find meaningful work, and grow your career."}
        </p>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleSocialSignup("Google")}
            className="flex cursor-pointer h-12 items-center justify-center gap-3 rounded-xl border border-black/13 bg-white px-4 text-sm font-semibold text-[#30332f] transition hover:border-black/20 hover:bg-[#f8f9f7] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4c7849]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 4.98-.9 6.64-2.43l-3.24-2.52c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.05v2.6A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.39 13.88A6 6 0 0 1 6.07 12c0-.65.11-1.29.32-1.88v-2.6H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.48l3.34-2.6Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.99c1.47 0 2.79.5 3.83 1.5l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.95 5.52l3.34 2.6C7.18 7.75 9.39 5.99 12 5.99Z"
              />
            </svg>
            Google
          </button>

          <button
            type="button"
            onClick={() => handleSocialSignup("GitHub")}
            className="flex cursor-pointer h-12 items-center justify-center gap-3 rounded-xl border border-black/13 bg-white px-4 text-sm font-semibold text-[#30332f] transition hover:border-black/20 hover:bg-[#f8f9f7] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4c7849]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.91-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.92a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.8 0 .27.18.59.69.49A10.24 10.24 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
            </svg>
            GitHub
          </button>
        </div>

        <div className="flex items-center gap-4 py-1">
          <span className="h-px flex-1 bg-black/10"></span>
          <span className="text-xs font-medium text-[#8a8e87]">
            or continue with email
          </span>
          <span className="h-px flex-1 bg-black/10"></span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
            First name
            <input
              name="firstName"
              type="text"
              autoComplete="given-name"
              required
              className="h-12 rounded-xl border border-black/13 bg-white px-4 font-normal outline-none transition placeholder:text-[#a2a59f] focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
              placeholder="First name"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
            Last name
            <input
              name="lastName"
              type="text"
              autoComplete="family-name"
              required
              className="h-12 rounded-xl border border-black/13 bg-white px-4 font-normal outline-none transition placeholder:text-[#a2a59f] focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
              placeholder="Last name"
            />
          </label>
        </div>

        <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-12 rounded-xl border border-black/13 bg-white px-4 font-normal outline-none transition placeholder:text-[#a2a59f] focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
            placeholder="you@example.com"
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
          Country
          <span className="relative">
            <select
              name="country"
              autoComplete="country-name"
              defaultValue=""
              required
              className="h-12 w-full appearance-none rounded-xl border border-black/13 bg-white px-4 pr-11 font-normal outline-none transition invalid:text-[#a2a59f] focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
            >
              <option value="" disabled>
                Select your country
              </option>
              {countries.map((country) => (
                <option
                  key={country.code}
                  value={country.code}
                  className="text-[#30332f]"
                >
                  {country.name}
                </option>
              ))}
            </select>
            <svg
              viewBox="0 0 20 20"
              className="pointer-events-none absolute top-1/2 right-4 h-4 w-4 -translate-y-1/2 text-[#737770]"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m6 8 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[#30332f]">
          Password
          <span className="relative">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={8}
              required
              className="h-12 w-full rounded-xl border border-black/13 bg-white px-4 pr-20 font-normal outline-none transition placeholder:text-[#a2a59f] focus:border-[#5d8b59] focus:ring-3 focus:ring-[#dcebd9]"
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute cursor-pointer inset-y-0 right-4 text-xs font-semibold text-[#52764f]"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>

        <label className="flex items-start gap-3 text-xs leading-5 text-[#686c65]">
          <input
            name="terms"
            type="checkbox"
            required
            className="mt-0.5 h-4 w-4 rounded border-black/20 accent-[#426f40]"
          />
          <span>
            I agree to the{" "}
            <Link
              href="/terms"
              className="font-semibold text-[#416d3e] hover:underline!"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="font-semibold text-[#416d3e] hover:underline!"
            >
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        <div
          id="clerk-captcha"
          data-cl-theme="light"
          data-cl-size="flexible"
          data-cl-language="auto"
          className="flex w-full justify-center"
        />

        <button
          type="submit"
          disabled={isLoading}
          className="h-12 cursor-pointer w-full rounded-xl bg-[#252724] text-sm font-semibold text-white shadow-sm transition hover:bg-[#3b3e39] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4c7849]"
        >
          {isLoading
            ? "Creating account..."
            : `Create ${isClient ? "client" : "freelancer"} account`}
        </button>

        {status && (
          <p
            className={`rounded-xl bg-[#edf5eb] px-4 py-3 text-center text-xs font-medium text-[#4e704b]
              
              ${
                isError
                  ? "bg-[#fff0ee] text-[#914d45]"
                  : "bg-[#edf5eb] text-[#3e704b]"
              }
              `}
            role="status"
          >
            {status}
          </p>
        )}
      </form>

      <p className="mt-7 text-center text-sm text-[#555952]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-semibold text-[#397236] hover:underline!"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
