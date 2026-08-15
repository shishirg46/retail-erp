// Route-level export parameter validation (M20).

import { ValidationError } from "../../lib/errors";

import type { ExportFormat } from "./export.types";

// `format` is optional and defaults to CSV (the accountant-facing format).
// Accepted values are case-insensitive; anything else is a 400.
export function parseExportFormat(searchParams: URLSearchParams): ExportFormat {
  const raw = searchParams.get("format");
  if (raw === null || raw === "") return "csv";

  const format = raw.toLowerCase();
  if (format !== "csv" && format !== "json") {
    throw new ValidationError(`format must be 'csv' or 'json' (got '${raw}')`);
  }

  return format;
}
