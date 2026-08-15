// M20 export serializers unit suite (Vitest).
//
// Proves the CSV encoder (RFC-4180 quoting, CRLF, UTF-8 BOM, and the
// text-only formula-injection guard), the streaming JSON encoder (byte-identical
// to JSON.stringify of the same report), the report → document layout, and the
// `format` query parameter. Pure functions — no database, no server.

import { describe, expect, it } from "vitest";
import { csvChunks, encodeCsvRow, escapeCsvField, CSV_BOM } from "../../modules/exports/csv";
import { jsonChunks } from "../../modules/exports/json";
import { exportFilename, reportToDocument } from "../../modules/exports/export.definitions";
import { parseExportFormat } from "../../modules/exports/export.validation";
import { ValidationError } from "../../lib/errors";
import type { SalesReport, WalletReport } from "../../modules/reports/report.types";

const concat = (chunks: Generator<Buffer>): string =>
  [...chunks].map((chunk) => chunk.toString("utf8")).join("");

const salesReport: SalesReport = {
  range: { from: "2026-08-15T00:00:00.000+05:45", to: null },
  totalSales: 150,
  numberOfSales: 3,
  byPaymentType: [
    { paymentType: "CASH", count: 1, total: 60 },
    { paymentType: "ECASH", count: 1, total: 60 },
    { paymentType: "CREDIT", count: 1, total: 30 },
  ],
  productQuantities: [
    { productId: "p-1", productName: "Rpt Rice", quantity: 3, amount: 60 },
    { productId: "p-2", productName: "Rpt Oil, liter", quantity: 3, amount: 90 },
  ],
};

describe("escapeCsvField", () => {
  it("emits plain strings and numbers unchanged", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("Rpt Rice")).toBe("Rpt Rice");
    expect(escapeCsvField(19.99)).toBe("19.99");
    expect(escapeCsvField(0)).toBe("0");
  });

  it("keeps legitimate negative money bare (text-only guard)", () => {
    expect(escapeCsvField(-120)).toBe("-120");
    expect(escapeCsvField(150)).toBe("150");
  });

  it("quotes fields containing commas, quotes, or newlines (RFC-4180)", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("a\rb")).toBe('"a\rb"');
  });

  it("neutralizes formula injection only for string cells", () => {
    expect(escapeCsvField("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(escapeCsvField("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(escapeCsvField("@SUM(1,2)")).toBe("\"'@SUM(1,2)\"");
    expect(escapeCsvField("-1+2")).toBe("'-1+2");
    expect(escapeCsvField("\t=1")).toBe("'\t=1");
  });

  it("renders non-finite numbers as an empty cell", () => {
    expect(escapeCsvField(Number.NaN)).toBe("");
    expect(escapeCsvField(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("encodeCsvRow", () => {
  it("joins cells with commas and terminates rows with CRLF", () => {
    expect(encodeCsvRow(["a", "b", 1])).toBe("a,b,1\r\n");
    expect(encodeCsvRow(["a,b", 'c"d'])).toBe('"a,b","c""d"\r\n');
  });
});

describe("csvChunks", () => {
  it("prepends the UTF-8 BOM and emits metadata + tables in order", () => {
    const out = concat(csvChunks(reportToDocument("sales", salesReport)));
    expect(out.startsWith(CSV_BOM)).toBe(true);

    const body = out.slice(1); // drop BOM for readability of the assertions below
    expect(body.startsWith("Report,sales\r\n")).toBe(true);
    expect(body).toContain("From,2026-08-15T00:00:00.000+05:45\r\n");
    expect(body).toContain("To,\r\n");
    expect(body).toContain("\r\n\r\nSummary\r\nKey,Value\r\n");
    expect(body).toContain("Total sales,150\r\n");
    expect(body).toContain("Number of sales,3\r\n");
    expect(body).toContain(
      "\r\n\r\nProducts sold\r\nProduct ID,Product name,Quantity,Amount\r\n"
    );
    expect(body).toContain("p-1,Rpt Rice,3,60\r\n");
    // The comma inside the product name is quoted.
    expect(body).toContain('p-2,"Rpt Oil, liter",3,90\r\n');
    // No stray leading comma after the BOM.
    expect(out).toBe(CSV_BOM + body);
  });
});

describe("jsonChunks", () => {
  it("is byte-identical to JSON.stringify for the same report", () => {
    for (const report of [salesReport, salesReport]) {
      expect(concat(jsonChunks(report))).toBe(JSON.stringify(report));
    }
  });

  it("round-trips through JSON.parse to the original object", () => {
    const parsed = JSON.parse(concat(jsonChunks(salesReport))) as SalesReport;
    expect(parsed).toEqual(salesReport);
  });
});

describe("reportToDocument", () => {
  it("lays out the wallet report with a summary and by-source table", () => {
    const wallet: WalletReport = {
      range: { from: null, to: null },
      deposits: 130,
      withdrawals: 250,
      balance: -120,
      bySource: [
        { source: "SALE", deposits: 120, withdrawals: 0, count: 3 },
        { source: "SUPPLIER_PAYMENT", deposits: 0, withdrawals: 250, count: 1 },
      ],
    };

    const document = reportToDocument("wallet", wallet);
    expect(document.metadata).toEqual([
      { key: "Report", value: "wallet" },
      { key: "From", value: null },
      { key: "To", value: null },
    ]);

    const tables = new Map(document.tables.map((table) => [table.title, table]));
    expect(tables.get("Summary")!.rows).toEqual([
      ["Deposits", 130],
      ["Withdrawals", 250],
      ["Balance", -120],
    ]);
    expect(tables.get("By source")!.columns).toEqual([
      "Source",
      "Deposits",
      "Withdrawals",
      "Count",
    ]);
    expect(tables.get("By source")!.rows).toContainEqual(["SALE", 120, 0, 3]);

    // Negative balances survive the CSV injection guard as bare numbers.
    const csv = concat(csvChunks(document));
    expect(csv).toContain("Balance,-120\r\n");
  });

  it("keeps each report name on its own layout", () => {
    const stock = {
      range: { from: null, to: null },
      currentStock: [],
      movementSummary: [],
    } as never;

    const document = reportToDocument("stock", stock);
    expect(document.tables.map((table) => table.title)).toEqual([
      "Current stock",
      "Movement summary",
    ]);
  });
});

describe("parseExportFormat", () => {
  it("defaults to csv and accepts csv/json case-insensitively", () => {
    expect(parseExportFormat(new URLSearchParams())).toBe("csv");
    expect(parseExportFormat(new URLSearchParams("format=csv"))).toBe("csv");
    expect(parseExportFormat(new URLSearchParams("format=JSON"))).toBe("json");
    expect(parseExportFormat(new URLSearchParams("format=json"))).toBe("json");
  });

  it("rejects unknown formats with a ValidationError", () => {
    expect(() => parseExportFormat(new URLSearchParams("format=xml"))).toThrow(
      ValidationError
    );
    expect(() => parseExportFormat(new URLSearchParams("format="))).not.toThrow();
  });
});

describe("exportFilename", () => {
  it("names files <report>-report.<format>", () => {
    expect(exportFilename("sales", "csv")).toBe("sales-report.csv");
    expect(exportFilename("wallet", "json")).toBe("wallet-report.json");
  });
});
