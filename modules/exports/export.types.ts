// Data export types (D20 / M20).
//
// An export is a serialization of a D7 report — the exact read-only derivation
// the corresponding /api/reports/{name} endpoint returns — into a downloadable
// file (CSV or JSON). Exports never compute their own figures: the report
// service produces the payload, so the D7 derivation, D10 range echo, and
// D18.8 void exclusion stay byte-identical to the report endpoints.

import type {
  CustomersReport,
  PurchasesReport,
  SalesReport,
  StockReport,
  SuppliersReport,
  WalletReport,
} from "../reports/report.types";

export type ReportName =
  | "sales"
  | "purchases"
  | "stock"
  | "customers"
  | "suppliers"
  | "wallet";

export type ExportFormat = "csv" | "json";

// Any report payload the export layer serializes.
export type AnyReport =
  | SalesReport
  | PurchasesReport
  | StockReport
  | CustomersReport
  | SuppliersReport
  | WalletReport;

// One metadata row rendered as `Key,Value` in CSV (and echoed in the JSON
// export via the report's own `range`/summary fields).
export interface ExportMetadataRow {
  key: string;
  value: string | number | null;
}

// A rectangular table inside the exported document: a single-cell title row,
// a header row, then data rows.
export interface ExportTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

// The full CSV document: metadata rows first, then one table per section.
export interface ExportDocument {
  metadata: ExportMetadataRow[];
  tables: ExportTable[];
}
