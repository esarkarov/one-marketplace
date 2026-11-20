export function loginErrorMessage(
  status: number,
  result: { code?: unknown; message?: unknown } | null,
): string {
  if (result?.code === "ADMIN_AUTH_NOT_CONFIGURED") {
    return "Admin sign-in is not configured on the server.";
  }
  if (status === 401) return "Incorrect password.";
  if (typeof result?.message === "string" && result.message) {
    return result.message;
  }
  return "Incorrect password.";
}
