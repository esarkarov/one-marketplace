import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, isApiError } from "@onemarketplace/api-client";
import {
  createAdminApi,
  getApiBaseUrl,
  type AdminApi,
} from "../../lib/admin-api";
import { SESSION_COOKIE } from "../../lib/admin-session";
import { expiredLoginPath } from "../../lib/safe-next-path";

export type AdminResult<T> =
  { data: T; error: null } | { data: null; error: ApiError | Error };

export async function fetchAdmin<T>(
  currentPath: string,
  call: (api: AdminApi) => Promise<T>,
): Promise<AdminResult<T>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  let failure: unknown;

  try {
    const api = createAdminApi({ baseUrl: getApiBaseUrl(), token });
    return { data: await call(api), error: null };
  } catch (error) {
    failure = error;
  }

  if (isApiError(failure) && failure.status === 401) {
    redirect(expiredLoginPath(currentPath));
  }

  return {
    data: null,
    error: failure instanceof Error ? failure : new Error("Request failed."),
  };
}
