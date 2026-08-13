import { ValidationError } from "../../lib/errors";

import type { ReportDateRange } from "./report.types";

function parseDateParam(
  value: string,
  name: "from" | "to"
): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${name} must be a valid ISO-8601 date`);
  }

  return parsed;
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