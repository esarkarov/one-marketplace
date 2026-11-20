import type { Metadata } from "next";
import { safeNextPath } from "../../lib/safe-next-path";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin access" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; expired?: string }>;
}) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  return (
    <LoginForm next={safeNextPath(next)} expired={params.expired === "1"} />
  );
}
