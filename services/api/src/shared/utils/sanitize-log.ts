const MAX_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 300;

const RULES: [RegExp, string][] = [
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, "[Redacted]"],
  [/\b(?:sk|rk|pk)_[A-Za-z0-9]{8,}/g, "[Redacted]"],
  [/\bwhsec_[A-Za-z0-9]+/g, "[Redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [Redacted]"],
  [/(authorization["']?\s*[:=]\s*)["']?[^\s"',}]+/gi, "$1[Redacted]"],
  [/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[Redacted]@"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[Redacted]"],
  [/\b(?:private|public)_[A-Za-z0-9+/=_-]{8,}/g, "[Redacted]"],
  [/\b[A-Fa-f0-9]{40,}\b/g, "[Redacted]"],
];

export const sanitizeForLog = (text: string): string => {
  let result = text;
  for (const [pattern, replacement] of RULES) {
    result = result.replace(pattern, replacement);
  }
  return result.length > MAX_LENGTH ? result.slice(0, MAX_LENGTH) : result;
};

export const errorMessageForLog = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.trimStart().startsWith("Failed query:")) {
    return "Database query failed";
  }
  return sanitizeForLog(firstLine).slice(0, MAX_MESSAGE_LENGTH);
};

export const errorCodeForLog = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === "string") return nested;
  }
  return undefined;
};

export const errorLogAttributes = (
  error: unknown,
): { "error.message": string; "error.code"?: string } => {
  const code = errorCodeForLog(error);
  return {
    "error.message": errorMessageForLog(error),
    ...(code === undefined ? {} : { "error.code": code }),
  };
};
