const MAX_LENGTH = 2000;

const RULES: [RegExp, string][] = [
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g, "[Redacted]"],
  [/\b(?:sk|rk|pk)_[A-Za-z0-9]{8,}/g, "[Redacted]"],
  [/\bwhsec_[A-Za-z0-9]+/g, "[Redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [Redacted]"],
  [/(authorization["']?\s*[:=]\s*)["']?[^\s"',}]+/gi, "$1[Redacted]"],
  [/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[Redacted]@"],
];

export const sanitizeForLog = (text: string): string => {
  let result = text;
  for (const [pattern, replacement] of RULES) {
    result = result.replace(pattern, replacement);
  }
  return result.length > MAX_LENGTH ? result.slice(0, MAX_LENGTH) : result;
};
