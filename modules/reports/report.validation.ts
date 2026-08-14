import { ValidationError } from "../../lib/errors";
import { naiveAsShopLocal } from "../../lib/timezone";

import type { ReportDateRange } from "./report.types";

// A string that already pins an instant carries an explicit timezone marker:
// 'Z', an ISO offset (+05:45 / -0800), or an IANA name in brackets. Anything
// else is a naive wall-clock value and is interpreted in the shop timezone (D10).
const HAS_TIMEZONE = /[zZ]|[+-]\d{2}:?\d{2}(\.\d{1,3})?$|\[[\w/_-]+\]$/;

// yyyy-mm-dd, optionally followed by T hh:mm:ss(.sss).
const NAIVE_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

function parseDateParam(
  value: string,
  name: "from" | "to"
): Date {
  // Absolute timestamps (with an explicit zone) parse exactly as-is.
  if (HAS_TIMEZONE.test(value)) {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError(`${name} must be a valid ISO-8601 date`);
    }

    return parsed;
  }

  // Naive date/datetime -> the instant the shop clock reads those components
  // (Asia/Kathmandu by default, D10). Keeps report days host-timezone-stable.
  const match = NAIVE_DATE.exec(value);

  if (match === null) {
    throw new ValidationError(`${name} must be a valid ISO-8601 date`);
  }

  const [, year, month, day, hour, minute, second, fraction] = match;

  // Reject impossible wall-clock components (e.g. 2026-99-99) instead of
  // letting Date roll them over into a "valid" but wrong instant.
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour ?? 0),
    minute: Number(minute ?? 0),
    second: Number(second ?? 0),
  };

  const inRange = (n: number, lo: number, hi: number) => n >= lo && n <= hi;
  const valid =
    inRange(parts.month, 1, 12) &&
    inRange(parts.day, 1, 31) &&
    inRange(parts.hour, 0, 23) &&
    inRange(parts.minute, 0, 59) &&
    inRange(parts.second, 0, 59);

  if (!valid) {
    throw new ValidationError(`${name} must be a valid ISO-8601 date`);
  }

  return naiveAsShopLocal(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    fraction ? Number(fraction.padEnd(3, "0")) : 0
  );
}

// Reads `from`/`to` from the query string. Both are optional; invalid values or a
// from > to window are rejected with a 400. Absent bounds mean "full history".
export function parseReportDateRange(
  searchParams: URLSearchParams
): ReportDateRange {
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");

  if (fromRaw === null && toRaw === null) {
    return {};
  }

  let from: Date | undefined;
  let to: Date | undefined;

  if (fromRaw !== null) from = parseDateParam(fromRaw, "from");
  if (toRaw !== null) to = parseDateParam(toRaw, "to");

  if (from !== undefined && to !== undefined && from.getTime() > to.getTime()) {
    throw new ValidationError("from must not be later than to");
  }

  return { ...(from !== undefined && { from }), ...(to !== undefined && { to }) };
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

// Accept yyyy-mm-dd (preferred for reports) or a full ISO-8601 timestamp.
// yyyy-mm-dd is treated as a local midnight.
export function coerceRangeQuery(searchParams: URLSearchParams): URLSearchParams {
  const coerced = new URLSearchParams(searchParams);

  const clampDay = (key: "from" | "to", inclusive: boolean) => {
    const value = coerced.get(key);
    if (value === null) return;

    const match = ISO_DATE_PATTERN.exec(value);
    if (match === null) return;

    const [, year, month, day] = match;
    const hasTime = value.length > 10 && /T/.test(value);
    if (hasTime) return;

    if (inclusive) {
      coerced.set(key, `${year}-${month}-${day}T23:59:59.999`);
    } else {
      coerced.set(key, `${year}-${month}-${day}T00:00:00.000`);
    }
  };

  clampDay("from", false);
  clampDay("to", true);

  return coerced;
}