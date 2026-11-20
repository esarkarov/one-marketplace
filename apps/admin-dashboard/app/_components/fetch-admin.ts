import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../../lib/admin-session";

// Server-only — reads the httpOnly session cookie (invisible to client JS by
// design) and forwards it to the backend, which independently verifies the
// same signed token. Only call this from Server Components.
export async function fetchAdmin<T>(
  path: string,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}${path}`,
      {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );
    const result = await response.json();
    if (!response.ok) {
      return { data: null, error: result.message || "Request failed." };
    }
    return { data: result.data as T, error: null };
  } catch {
    return { data: null, error: "Could not reach the server." };
  }
}
