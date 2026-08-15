// CSV encoder (D20.1 / M20).
//
// Format: comma separator, RFC-4180 double-quote escaping, CRLF row terminator,
// and a UTF-8 BOM at the very start so Excel detects the encoding and renders
// non-ASCII values (Nepali names, ₹ symbols) correctly.
//
// CSV-injection guard: string cells that begin with a formula-trigger character
// (`=`, `+`, `-`, `@`, tab, CR) get a leading single quote so a spreadsheet
// treats the cell as text instead of executing it. Numeric cells are emitted
// bare, so legitimate negative money (e.g. -120 for prepaid credit) is never
// mangled — the guard applies to text only.

import type { ExportDocument } from "./export.types";

export const CSV_BOM = "\uFEFF";

const FORMULA_TRIGGER = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function escapeCsvField(value: string | number): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  let field = value;
  const first = field.charAt(0);
  if (first !== "" && FORMULA_TRIGGER.has(first)) {
    field = `'${field}`;
  }

  if (
    field.includes(",") ||
    field.includes('"') ||
    field.includes("\n") ||
    field.includes("\r")
  ) {
    field = `"${field.replace(/"/g, '""')}"`;
  }

  return field;
}

export function encodeCsvRow(cells: (string | number)[]): string {
  return cells.map(escapeCsvField).join(",") + "\r\n";
}

// Stream the document as small UTF-8 chunks: one chunk per row. The whole file
// is never materialized as a single string, so the response body stays bounded
// by the row size rather than the dataset size (D20.2).
export function* csvChunks(document: ExportDocument): Generator<Buffer> {
  yield Buffer.from(CSV_BOM, "utf8");

  for (const row of document.metadata) {
    yield Buffer.from(encodeCsvRow([row.key, row.value ?? ""]), "utf8");
  }

  for (const table of document.tables) {
    yield Buffer.from("\r\n", "utf8");
    yield Buffer.from(encodeCsvRow([table.title]), "utf8");
    yield Buffer.from(encodeCsvRow(table.columns), "utf8");
    for (const row of table.rows) {
      yield Buffer.from(encodeCsvRow(row), "utf8");
    }
  }
}
