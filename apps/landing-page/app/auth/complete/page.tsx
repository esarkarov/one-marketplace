"use client";
import { useSession } from "@clerk/nextjs";
import { useEffect, useRef } from "react";

const Page = () => {
  const { isLoaded, session } = useSession();
  const hasRedirect = useRef(false);

  useEffect(() => {
    if (!isLoaded || !session || hasRedirect.current) {
      return;
    }

    hasRedirect.current = true;

    void session.getToken().then((token) => {
      if (!token) {
        hasRedirect.current = false;
        return;
      }

      const role = new URLSearchParams(window.location.search).get("role");
      const roleQuery = role ? `&role=${encodeURIComponent(role)}` : "";

      window.location.assign(
        `/api/sign-up?token=${encodeURIComponent(token)}${roleQuery}`,
      );
    });
  }, [isLoaded, session]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#fbfcfa] px-6">
      <div className="text-center">
        <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[#dce8da] border-t-[#4c7849]" />
        <h1 className="mt-5 text-xl font-semibold text-[#20231f]">
          Finishing your account
        </h1>
        <p className="mt-2 text-sm text-[#767b73]">
          You’ll be redirected automatically.
        </p>
      </div>
    </main>
  );
};

export default Page;
