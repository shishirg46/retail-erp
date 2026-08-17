// Pre-Phase-D regression suite — verifies the data-model foundation:
//
// 1. Opening customer balances (D26)
// 2. Opening supplier balances (D26)
// 3. Shop Settings wallet opening balance (D26)
// 4. OPENING stock reason with stockQty=0 guard (D27)
// 5. unitsPerPack for packaged products (D28)
// 6. Sale item productName in API response
// 7. Stock movement productName in API response
// 8. Sale item lineTotal in API response
// 9. Purchase item productName in API response
//
// Runs against the real test database via HTTP routes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureNoForeignDevServer,
  errorBody,
  httpGet,
  httpPatch,
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

const port = 4800 + (process.pid % 400);
const prisma = createTestPrisma();

const OWNER = { username: "prephase-owner", password: "prephaseownerpass", role: "OWNER" } as const;
const CASHIER = { username: "prephase-cashier", password: "prephasecashierpass", role: "CASHIER" } as const;

interface Identified {
  id: string;
}

describe("Pre-Phase-D regression", () => {
  let server: Server;
  let p = 0;
  let ownerCookie = "";
  let cashierCookie = "";
  let customerId = "";
  let supplierId = "";
  let productId = "";
  let productId2 = "";

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
      "/api/customers",
      "/api/suppliers",
      "/api/settings",
      "/api/sales",
      "/api/stock/movements",
    ]);
    ownerCookie = await signIn(p, `${OWNER.username}@erp.local`, OWNER.password);
    cashierCookie = await signIn(p, `${CASHIER.username}@erp.local`, CASHIER.password);
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  }, 300000);

  // --- D26: Opening customer balance ---
  it("customers: create with openingBalance → 201, balanceOwed reflects opening", async () => {
    const res = await httpPost(p, "/api/customers", {
      name: "D26 Customer",
      openingBalance: 500,
    }, ownerCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; openingBalance: number; balanceOwed: number };
    customerId = body.id;
    expect(body.openingBalance).toBe(500);
    expect(body.balanceOwed).toBe(500);
  });

  it("customers: create with zero openingBalance → 201", async () => {
    const res = await httpPost(p, "/api/customers", {
      name: "Zero Opening",
      openingBalance: 0,
    }, ownerCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { openingBalance: number; balanceOwed: number };
    expect(body.openingBalance).toBe(0);
    expect(body.balanceOwed).toBe(0);
  });

  it("customers: CASHIER cannot set openingBalance → 403", async () => {
    const res = await httpPost(p, "/api/customers", {
      name: "Cashier Try",
      openingBalance: 100,
    }, cashierCookie);
    expect(res.status).toBe(403);
  });

  // --- D26: Opening supplier balance ---
  it("suppliers: create with openingBalance → 201, balanceOwed reflects opening", async () => {
    const res = await httpPost(p, "/api/suppliers", {
      name: "D26 Supplier",
      openingBalance: 300,
    }, ownerCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; openingBalance: number; balanceOwed: number };
    supplierId = body.id;
    expect(body.openingBalance).toBe(300);
    expect(body.balanceOwed).toBe(300);
  });

  it("suppliers: create without openingBalance → 201, defaults to 0", async () => {
    const res = await httpPost(p, "/api/suppliers", {
      name: "No Opening Supplier",
    }, ownerCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { openingBalance: number; balanceOwed: number };
    expect(body.openingBalance).toBe(0);
    expect(body.balanceOwed).toBe(0);
  });

  // --- D26: Shop Settings wallet opening balance ---
  it("settings: GET returns walletOpeningBalance → 200", async () => {
    const res = await httpGet(p, "/api/settings", ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { walletOpeningBalance: number; goLiveAt: string | null };
    expect(typeof body.walletOpeningBalance).toBe("number");
  });

  it("settings: PATCH walletOpeningBalance → 200", async () => {
    const res = await httpPatch(p, "/api/settings", {
      walletOpeningBalance: 10000,
    }, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { walletOpeningBalance: number };
    expect(body.walletOpeningBalance).toBe(10000);
  });

  // --- Product setup for stock tests ---
  it("products: create product for OPENING test → 201", async () => {
    const res = await httpPost(p, "/api/products", {
      name: "Opening Test Product",
      unit: "pcs",
      costPrice: 10,
      currentPrice: 20,
    }, ownerCookie);
    expect(res.status).toBe(201);
    productId = ((await res.json()) as Identified).id;
  });

  it("products: create product for unitsPerPack test → 201", async () => {
    const res = await httpPost(p, "/api/products", {
      name: "Pack Product",
      unit: "pcs",
      costPrice: 5,
      currentPrice: 10,
      unitsPerPack: 12,
    }, ownerCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; unitsPerPack: number };
    productId2 = body.id;
    expect(body.unitsPerPack).toBe(12);
  });

  // --- D27: OPENING stock reason ---
  it("stock: OPENING on zero-stock product → 201, sets stockQty", async () => {
    const res = await httpPost(p, "/api/stock/adjustments", {
      productId,
      reason: "OPENING",
      quantity: 50,
      note: "Initial stock count",
    }, ownerCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { product: { stockQty: number } };
    expect(body.product.stockQty).toBe(50);
  });

  it("stock: OPENING on non-zero-stock product → 400", async () => {
    const res = await httpPost(p, "/api/stock/adjustments", {
      productId,
      reason: "OPENING",
      quantity: 10,
      note: "Should fail",
    }, ownerCookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toContain("stock is zero");
  });

  it("stock: CASHIER cannot use OPENING → 403", async () => {
    const res = await httpPost(p, "/api/stock/adjustments", {
      productId: productId2,
      reason: "OPENING",
      quantity: 20,
    }, cashierCookie);
    expect(res.status).toBe(403);
  });

  // --- D28: unitsPerPack ---
  it("products: unitsPerPack returned in GET → 12", async () => {
    const res = await httpGet(p, `/api/products/${productId2}`, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unitsPerPack: number };
    expect(body.unitsPerPack).toBe(12);
  });

  it("products: create without unitsPerPack → null", async () => {
    const res = await httpGet(p, `/api/products/${productId}`, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unitsPerPack: number | null };
    expect(body.unitsPerPack).toBeNull();
  });

  it("products: unitsPerPack on non-pcs product → 400", async () => {
    const res = await httpPost(p, "/api/products", {
      name: "Kg Pack Product",
      unit: "kg",
      costPrice: 5,
      currentPrice: 10,
      unitsPerPack: 6,
    }, ownerCookie);
    expect(res.status).toBe(400);
  });

  it("products: unitsPerPack=1 → 400 (must be >= 2)", async () => {
    const res = await httpPost(p, "/api/products", {
      name: "Bad Pack",
      unit: "pcs",
      costPrice: 5,
      currentPrice: 10,
      unitsPerPack: 1,
    }, ownerCookie);
    expect(res.status).toBe(400);
  });

  // --- Regression: sale item productName, lineTotal ---
  it("sales: CASH sale item has productName and lineTotal → 201", async () => {
    const res = await httpPost(p, "/api/sales", {
      customerId,
      paymentType: "CASH",
      items: [{ productId, quantity: 2, pricePerUnit: 20 }],
    }, ownerCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      items: Array<{ productName: string; lineTotal: number; qty: number; pricePerUnit: number }>;
    };
    expect(body.items.length).toBe(1);
    expect(body.items[0].productName).toBe("Opening Test Product");
    expect(body.items[0].lineTotal).toBe(40);
    expect(body.items[0].qty).toBe(2);
    expect(body.items[0].pricePerUnit).toBe(20);
  });

  // --- Regression: stock movement productName ---
  it("stock/movements: movement has productName → 200", async () => {
    const res = await httpGet(p, "/api/stock/movements", ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ productName: string; reason: string }>;
    expect(body.length).toBeGreaterThan(0);
    const openingMovement = body.find((m) => m.reason === "OPENING");
    expect(openingMovement).toBeDefined();
    expect(openingMovement!.productName).toBe("Opening Test Product");
  });

  // --- Regression: purchase item productName ---
  it("purchases: CASH purchase item has productName → 201", async () => {
    const res = await httpPost(p, "/api/purchases", {
      supplierId,
      paymentType: "CASH",
      items: [{ productId, quantity: 5, costPerUnit: 10 }],
    }, ownerCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      items: Array<{ productName: string; quantity: number; costPerUnit: number }>;
    };
    expect(body.items.length).toBe(1);
    expect(body.items[0].productName).toBe("Opening Test Product");
  });
});
