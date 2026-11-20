export const EMPTY_DATE = "—";

export interface DateFormatOptions {
  locale?: string;
  timeZone?: string;
}

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Default locale en-US and time zone UTC keep output deterministic. */
export const formatDate = (
  iso: string | Date | null | undefined,
  options: DateFormatOptions = {},
): string => {
  const date = toDate(iso);
  if (!date) return EMPTY_DATE;
  return new Intl.DateTimeFormat(options.locale ?? "en-US", {
    dateStyle: "medium",
    timeZone: options.timeZone ?? "UTC",
  }).format(date);
};

export const formatDateTime = (
  iso: string | Date | null | undefined,
  options: DateFormatOptions = {},
): string => {
  const date = toDate(iso);
  if (!date) return EMPTY_DATE;
  return new Intl.DateTimeFormat(options.locale ?? "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: options.timeZone ?? "UTC",
  }).format(date);
};

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export const formatRelative = (
  iso: string | Date | null | undefined,
  now: Date = new Date(),
  locale = "en-US",
): string => {
  const date = toDate(iso);
  if (!date) return EMPTY_DATE;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(seconds);

  for (const [unit, size] of UNITS) {
    if (absolute >= size) {
      return formatter.format(Math.trunc(seconds / size), unit);
    }
  }

  return formatter.format(seconds, "second");
};
