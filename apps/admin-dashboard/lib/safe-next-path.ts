const DUMMY_ORIGIN = "https://admin.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeNextPath(input: string | null | undefined): string {
  if (typeof input !== "string" || input.length === 0) return "/";
  if (!input.startsWith("/")) return "/";
  if (input.startsWith("//") || input.startsWith("/\\")) return "/";
  if (input.includes("\\")) return "/";
  if (CONTROL_CHARACTERS.test(input)) return "/";

  try {
    const parsed = new URL(input, DUMMY_ORIGIN);
    if (parsed.origin !== DUMMY_ORIGIN) return "/";
    if (parsed.pathname.startsWith("//")) return "/";
  } catch {
    return "/";
  }

  return input;
}

export function expiredLoginPath(currentPath: string): string {
  return `/login?expired=1&next=${encodeURIComponent(safeNextPath(currentPath))}`;
}
