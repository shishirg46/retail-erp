// Shop-local date derivation (D10, Q4).
//
// The report range echo is the only backend timezone signal: instants render
// as ISO-8601 with the shop's own offset (formatShopLocal, lib/timezone.ts),
// e.g. "2026-08-14T00:00:00.000+05:45". The frontend derives that offset to
// compute the shop-local "today" and report presets — it NEVER trusts the
// phone/browser timezone (Q4). Query boundaries are sent as naive YYYY-MM-DD
// and the backend reinterprets them in the shop timezone (report.validation.ts).

import type { ReportRange } from "@/modules/reports/report.types";

const OFFSET_RE = /([+-])(\d{2}):?(\d{2})$/;

// "2026-08-14T00:00:00.000+05:45" -> 345; "...Z" -> 0; naive -> null.
export function parseOffsetMinutes(isoWithOffset: string): number | null {
  if (/[zZ]$/.test(isoWithOffset)) return 0;
  const match = OFFSET_RE.exec(isoWithOffset);
  if (!match) return null;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

// The shop's UTC offset in minutes, derived from the range echo (Q4).
export function shopOffsetMinutesFromRange(range: ReportRange): number | null {
  const instant = range.from ?? range.to;
  if (!instant) return null;
  return parseOffsetMinutes(instant);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Shop-local wall-clock now, as a Date whose UTC fields equal the shop's
// Y/M/D/H/M/S. Exactly what the browser sees at `now + offset`.
function shopLocalWallClock(offsetMinutes: number, now: Date): Date {
  return new Date(now.getTime() + offsetMinutes * 60_000);
}

function naiveDate(clock: Date): string {
  return `${clock.getUTCFullYear()}-${pad(clock.getUTCMonth() + 1)}-${pad(clock.getUTCDate())}`;
}

function naiveDateAddDays(clock: Date, days: number): string {
  return naiveDate(new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate() + days)));
}

// Naive YYYY-MM-DD pair covering the shop-local "today" (Q4). Sent to
// `from=`/`to=`; the backend reinterprets them in the shop timezone.
export function shopLocalToday(
  offsetMinutes: number,
  now: Date = new Date()
): { from: string; to: string } {
  const date = naiveDate(shopLocalWallClock(offsetMinutes, now));
  return { from: date, to: date };
}

export type ReportPreset = "today" | "last7" | "last30" | "thisMonth" | "custom";

export interface ReportPresetRange {
  from: string;
  to: string;
}

// Preset -> naive date boundaries in the shop timezone (Q4). "custom" passes
// the caller's explicit from/to through untouched.
export function reportPresetRange(
  preset: ReportPreset,
  offsetMinutes: number,
  custom: ReportPresetRange = { from: "", to: "" },
  now: Date = new Date()
): ReportPresetRange {
  if (preset === "custom") return custom;

  const clock = shopLocalWallClock(offsetMinutes, now);
  const to = naiveDate(clock);

  switch (preset) {
    case "today":
      return { from: to, to };
    case "last7":
      return { from: naiveDateAddDays(clock, -6), to };
    case "last30":
      return { from: naiveDateAddDays(clock, -29), to };
    case "thisMonth":
      return {
        from: `${clock.getUTCFullYear()}-${pad(clock.getUTCMonth() + 1)}-01`,
        to,
      };
    default:
      return { from: to, to };
  }
}
