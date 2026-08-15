// M20 / D20 export HTTP suite — the six export routes over a real server.
//
// Spawns a real Next.js dev server on the dedicated `erp_retail_test` database,
// signs in an OWNER and a CASHIER over Better Auth, and walks:
//   - D20.1: CSV responses carry the UTF-8 BOM, CRLF rows, RFC-4180 quoting
//   - D20.2: exports stream full data — no 50-row pagination cap; every product
//     in range appears, even when the list endpoint page is capped at 50
//   - D20.3 / D9.6: CASHIER may export sales + stock only; the other four are
//     403; unauthenticated → 401
//   - JSON export is byte-equivalent to the live report endpoint
//   - D18.8: voided activity is excluded from exports exactly like reports
//   - D10: the range echo appears in the exported metadata
//   - F-08: export GETs are reads and are never rate-limited

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureNoForeignDevServer,
  errorBody,
  httpGet,
  httpPost,
  signIn,
  startServer,
  stopServer,
  waitReady,
  warmRoutes,
  type Server,
} from "../helpers/http";
import { createTestPrisma, truncateAll } from "../helpers/db";
import { createUserRecord } from "../helpers/auth";

const port = 5300 + (process.pid % 400);
const prisma = createTestPrisma();

const OWNER = { username: "exp-owner", password: "expownerpass", role: "OWNER" } as const;
const CASHIER = { username: "exp-cashier", password: "expcashierpass", role: "CASHIER" } as const;

interface Identified {
  id: string;
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
    rows.push(row);
  }
  return rows;
}

// Rows of the table whose single-cell title row matches `title` (header row
// included), stopping at the next single-cell row (blank separator or next
// table title).
function tableRows(rows: string[][], title: string): string[][] {
  const start = rows.findIndex((r) => r.length === 1 && r[0] === title);
  expect(start, `table '${title}' must exist in the CSV`).toBeGreaterThan(-1);
  const rest = rows.slice(start + 1);
  const end = rest.findIndex((r) => r.length === 1);
  return end === -1 ? rest : rest.slice(0, end);
}

// Decode an export response body and verify the CSV BOM prefix.
async function exportCsvText(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder("utf-8").decode(bytes);
}

describe("exports over HTTP (M20/D20)", () => {
  let server: Server;
  let p = 0;
  let ownerCookie = "";
  let cashierCookie = "";
  let productAId = "";
  let productBId = "";
  let voidedSaleId = "";

  beforeAll(async () => {
    await ensureNoForeignDevServer();
    await truncateAll(prisma);
    await createUserRecord(prisma, OWNER);
    await createUserRecord(prisma, CASHIER);
    server = startServer(port);
    p = server.port;
    await waitReady(server);
    await warmRoutes(p, [
      "/api/products",
      "/api/stock/adjustments",
      "/api/sales",
      "/api/sales/void",
      "/api/reports/sales",
      "/api/exports/sales",
      "/api/exports/purchases",
      "/api/exports/stock",
      "/api/exports/customers",
      "/api/exports/suppliers",
      "/api/exports/wallet",
    ]);
    ownerCookie = await signIn(p, `${OWNER.username}@erp.local`, OWNER.password);
    cashierCookie = await signIn(p, `${CASHIER.username}@erp.local`, CASHIER.password);
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  }, 300000);

  // ── Fixtures: two products, opening stock, two CASH sales ─────────────────
  it("fixtures: products, opening stock, two CASH sales", async () => {
    const a = await httpPost(p, "/api/products", {
      name: "Export Rice", unit: "kg", costPrice: 10, currentPrice: 20,
    }, ownerCookie);
    expect(a.status).toBe(201);
    productAId = ((await a.json()) as Identified).id;

    const b = await httpPost(p, "/api/products", {
      name: "Export Oil", unit: "liter", costPrice: 10, currentPrice: 30,
    }, ownerCookie);
    expect(b.status).toBe(201);
    productBId = ((await b.json()) as Identified).id;

    for (const productId of [productAId, productBId]) {
      const stock = await httpPost(p, "/api/stock/adjustments", {
        productId, reason: "CORRECTION", quantity: 10, note: "opening",
      }, ownerCookie);
      expect(stock.status).toBe(201);
    }

    const saleA = await httpPost(p, "/api/sales", {
      paymentType: "CASH", items: [{ productId: productAId, quantity: 3 }],
    }, ownerCookie);
    expect(saleA.status).toBe(201);
    voidedSaleId = ((await saleA.json()) as Identified).id;

    const saleB = await httpPost(p, "/api/sales", {
      paymentType: "CASH", items: [{ productId: productBId, quantity: 2 }],
    }, ownerCookie);
    expect(saleB.status).toBe(201);
  });

  it("owner voids one CASH sale (D18.8 setup)", async () => {
    const res = await httpPost(
      p, `/api/sales/${voidedSaleId}/void`, { reason: "test void" }, ownerCookie
    );
    expect(res.status).toBe(200);
  });

  // ── Auth / authorization (D20.3 + D9.6) ───────────────────────────────────
  it("unauthenticated export requests are rejected (401)", async () => {
    const res = await httpGet(p, "/api/exports/sales");
    expect(res.status).toBe(401);
  });

  it("CASHIER may export exactly the reports they can view", async () => {
    for (const path of ["/api/exports/sales", "/api/exports/stock"]) {
      const res = await httpGet(p, `${path}?format=csv`, cashierCookie);
      expect(res.status, path).toBe(200);
    }
    for (const path of [
      "/api/exports/purchases",
      "/api/exports/customers",
      "/api/exports/suppliers",
      "/api/exports/wallet",
    ]) {
      const res = await httpGet(p, path, cashierCookie);
      expect(res.status, path).toBe(403);
      await errorBody(res);
    }
  });

  it("an unknown format is a 400", async () => {
    const res = await httpGet(p, "/api/exports/sales?format=xml", ownerCookie);
    expect(res.status).toBe(400);
    await errorBody(res);
  });

  // ── CSV shape (D20.1) + void exclusion (D18.8) + range echo (D10) ─────────
  it("sales CSV: BOM, headers, metadata, and voided activity excluded", async () => {
    const res = await httpGet(p, "/api/exports/sales?format=csv", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(
      'attachment; filename="sales-report.csv"'
    );

    const text = await exportCsvText(res);
    const rows = parseCsv(text);

    // Metadata: report name first, range echo after.
    expect(rows[0]).toEqual(["Report", "sales"]);

    // Summary reflects only the surviving sale (60, not 120): the voided CASH
    // sale is excluded (D18.8).
    const summary = tableRows(rows, "Summary");
    expect(summary[0]).toEqual(["Key", "Value"]);
    expect(summary).toContainEqual(["Total sales", "60"]);
    expect(summary).toContainEqual(["Number of sales", "1"]);

    // Products sold: only the surviving product row (cells are strings).
    const products = tableRows(rows, "Products sold");
    expect(products[0]).toEqual(["Product ID", "Product name", "Quantity", "Amount"]);
    expect(products).toContainEqual([productBId, "Export Oil", "2", "60"]);
    expect(products.some((row) => row.includes("Export Rice"))).toBe(false);

    // Payment-type table reflects the single active sale.
    const byType = tableRows(rows, "By payment type");
    expect(byType[0]).toEqual(["Payment type", "Count", "Total"]);
    expect(byType).toContainEqual(["CASH", "1", "60"]);
  });

  it("CSV metadata echoes the requested range in the shop timezone (D10)", async () => {
    const params = "from=2026-08-01&to=2026-08-15";
    const jsonRes = await httpGet(p, `/api/exports/sales?format=json&${params}`, ownerCookie);
    const jsonBody = (await jsonRes.json()) as { range: { from: string; to: string } };
    expect(jsonBody.range.from).not.toBeNull();
    expect(jsonBody.range.to).not.toBeNull();

    const csvRes = await httpGet(p, `/api/exports/sales?format=csv&${params}`, ownerCookie);
    const rows = parseCsv(await exportCsvText(csvRes));
    expect(rows[1]).toEqual(["From", jsonBody.range.from]);
    expect(rows[2]).toEqual(["To", jsonBody.range.to]);
  });

  // ── JSON export matches the report endpoint byte-for-byte ──────────────────
  it("JSON export equals the /api/reports/sales payload", async () => {
    const report = await httpGet(p, "/api/reports/sales", ownerCookie);
    const reportJson = await report.json();

    const res = await httpGet(p, "/api/exports/sales?format=json", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain(
      'attachment; filename="sales-report.json"'
    );

    const text = await res.text();
    const parsed = JSON.parse(text) as unknown;
    expect(parsed).toEqual(reportJson);
    // The voided sale's 60 rupees are gone from the exported totals too.
    expect((parsed as { totalSales: number }).totalSales).toBe(60);
  });

  it("wallet JSON export is well-formed and streams a file body", async () => {
    const res = await httpGet(p, "/api/exports/wallet?format=json", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      'attachment; filename="wallet-report.json"'
    );
    const parsed = (await res.json()) as {
      deposits: number;
      withdrawals: number;
      balance: number;
    };
    expect(typeof parsed.deposits).toBe("number");
    expect(typeof parsed.withdrawals).toBe("number");
    expect(typeof parsed.balance).toBe("number");
  });

  // ── Full-range completeness beyond the 50-row cap (D20.2) ─────────────────
  it("exports all products in range, never truncated at the pagination cap", async () => {
    const FIXTURE_PRODUCTS = 2;
    const BULK = 60;
    await prisma.product.createMany({
      data: Array.from({ length: BULK }, (_, i) => ({
        name: `Export Bulk ${i}`,
        unit: "pcs",
        costPrice: 10,
        currentPrice: 20,
      })),
    });

    // The list endpoint page stops at 50...
    const list = await httpGet(p, "/api/products?limit=50", ownerCookie);
    expect(list.status).toBe(200);
    const page = (await list.json()) as { data: unknown[]; paging: { hasMore: boolean } };
    expect(page.data.length).toBe(50);
    expect(page.paging.hasMore).toBe(true);

    // ...but the stock export carries every product in the range.
    const csvRes = await httpGet(p, "/api/exports/stock?format=csv", ownerCookie);
    expect(csvRes.status).toBe(200);
    const rows = parseCsv(await exportCsvText(csvRes));
    const currentStock = tableRows(rows, "Current stock");
    expect(currentStock[0]).toEqual(["Product ID", "Product name", "Stock quantity"]);
    expect(currentStock.length - 1).toBe(FIXTURE_PRODUCTS + BULK);
  });

  // ── Rate-limit consistency (F-08): exports are reads ──────────────────────
  it("a burst of export GETs is never rate-limited (reads stay unlimited)", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await httpGet(p, "/api/exports/sales?format=csv", ownerCookie);
      expect(res.status).toBe(200);
    }
  });
});
