// F-03 HTTP integration suite (leak prevention on unexpected 500s).
//
// Spawns a real Next.js dev server against the dedicated `erp_retail_test`
// database and verifies over real HTTP:
//   Phase 1 — expected application errors keep their status + message
//             (400 malformed/invalid JSON, 400 validation, 404 not-found,
//             409 insufficient stock).
//   Phase 2 — an unreachable database produces a sanitized 500 whose body is
//             exactly `{ "message": "Internal Server Error" }` and contains no
//             driver text, filesystem paths, DB names, hosts, ports, Prisma
//             invocation details, or connection details.
//
// The suite refuses to start unless TEST_DATABASE_URL points at
// `erp_retail_test`, so the development database can never be connected to by
// the test server (guard lives in helpers/db.ts + helpers/http.ts).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureNoForeignDevServer,
  errorBody,
  httpGet,
  httpPost,
  httpPostRaw,
  startServer,
  stopServer,
  waitReady,
  type Server,
} from "../helpers/http";
import { createServerPrisma } from "../helpers/http";

const BASE_PORT = 4500 + (process.pid % 400);
const BAD_DATABASE_URL = "postgresql://bad:secret@127.0.0.1:1/erp_retail_test";

const prisma = createServerPrisma();

const LEAK_CANARIES = [
  "Can't reach database",
  "Can't reach database server",
  "Invalid `this.db",
  "Unique constraint failed",
  "findMany",
  "invocation in",
  ".next/",
  "/home/elshishir",
  "127.0.0.1",
  "5432",
  ":1",
  "postgresql://",
  "user:secret",
  "erp_retail",
  "developer connection",
  "at Object",
  "meta:",
  "stack",
  "node:internal",
];

function assertNoLeak(bodyText: string): void {
  const lower = bodyText.toLowerCase();
  for (const canary of LEAK_CANARIES) {
    expect(
      !lower.includes(canary.toLowerCase()),
      `500 body must not leak '${canary}' (got: ${bodyText.slice(0, 200)})`
    ).toBe(true);
  }
}

async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      wallet_transactions,
      credit_payments,
      sale_items,
      sales,
      stock_movements,
      purchase_items,
      purchases,
      price_tiers,
      products,
      supplier_payments,
      suppliers,
      customers
    CASCADE
  `);
}

describe("F-03 Phase 1: expected application errors keep status + message", () => {
  let server: Server;
  let port = 0;
  let productId = "";

  beforeAll(async () => {
    await ensureNoForeignDevServer();
    await resetDatabase();
    server = startServer(BASE_PORT);
    port = server.port;
    await waitReady(server);
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
    await resetDatabase();
    await prisma.$disconnect();
  }, 300000);

  it("P1 malformed JSON body → 400", async () => {
    const res = await httpPostRaw(port, "/api/products", "not-json");
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toBe("Invalid JSON body");
  });

  it("P1 invalid product payload → 400 validation", async () => {
    const res = await httpPost(port, "/api/products", {
      name: "Rice",
      unit: "kg",
      costPrice: 100,
      currentPrice: -5,
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/currentPrice/i);
  });

  it("P1 CREDIT sale without customerId → 400", async () => {
    const res = await httpPost(port, "/api/sales", {
      paymentType: "CREDIT",
      items: [],
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("P1 valid product → 201 (seed)", async () => {
    const res = await httpPost(port, "/api/products", {
      name: "F03 Test Product",
      unit: "kg",
      costPrice: 100,
      currentPrice: 120,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; stockQty: number };
    productId = body.id;
    expect(body.stockQty).toBe(0);
  });

  it("P1 GET unknown product id → 404", async () => {
    const res = await httpGet(
      port,
      "/api/products/00000000-0000-0000-0000-000000000000"
    );
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.message).toBe("Product not found");
  });

  it("P1 GET unknown sale id → 404", async () => {
    const res = await httpGet(
      port,
      "/api/sales/00000000-0000-0000-0000-000000000000"
    );
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.message).toBe("Sale not found");
  });

  it("P1 DAMAGE above stock → 409", async () => {
    const seed = await httpPost(port, "/api/stock/adjustments", {
      productId,
      reason: "CORRECTION",
      quantity: 3,
      note: "seed",
    });
    expect(seed.status).toBe(201);

    const res = await httpPost(port, "/api/stock/adjustments", {
      productId,
      reason: "DAMAGE",
      quantity: 5,
      note: "above stock",
    });
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.message).toMatch(/stock/i);
  });

  it("P1 valid GET /api/products → 200 (sanity)", async () => {
    const res = await httpGet(port, "/api/products");
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("F-03 Phase 2: unreachable DB → sanitized 500 over real HTTP", () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = startServer(BASE_PORT + 1, BAD_DATABASE_URL);
    port = server.port;
    await waitReady(server);
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
  }, 300000);

  it('P2 GET /api/products → 500 exactly {message:"Internal Server Error"}', async () => {
    const res = await httpGet(port, "/api/products");
    expect(res.status).toBe(500);
    const body = await errorBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
    assertNoLeak(JSON.stringify(body));
  });

  it("P2 POST /api/products (valid payload) → 500 sanitized on write path", async () => {
    const res = await httpPost(port, "/api/products", {
      name: "Leak",
      unit: "pcs",
      costPrice: 1,
      currentPrice: 2,
    });
    expect(res.status).toBe(500);
    const body = await errorBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
    assertNoLeak(JSON.stringify(body));
  });

  it("P2 GET /api/sales → 500 sanitized on another route", async () => {
    const res = await httpGet(port, "/api/sales");
    expect(res.status).toBe(500);
    const body = await errorBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
    assertNoLeak(JSON.stringify(body));
  });

  it("P2 report route → 500 sanitized", async () => {
    const res = await httpGet(port, "/api/reports/sales");
    expect(res.status).toBe(500);
    const body = await errorBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
    assertNoLeak(JSON.stringify(body));
  });
});