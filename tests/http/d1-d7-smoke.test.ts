// D1–D7 HTTP smoke suite — the full API surface over real HTTP.
//
// Spawns a real Next.js dev server bound to the dedicated `erp_retail_test`
// database (guard-verified) and walks every write + read route: products,
// stock adjustments, purchases, supplier payments, customers, customer
// payments, sales (CASH/ECASH/CREDIT), report reads, and 404/400 failure
// paths. Proves the routes stay wired and the D1–D7 responses well-formed
// end to end, on top of the service-level integration suites.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureNoForeignDevServer,
  errorBody,
  httpGet,
  httpPost,
  startServer,
  stopServer,
  waitReady,
  type Server,
} from "../helpers/http";
import { createTestPrisma, truncateAll } from "../helpers/db";

const port = 4700 + (process.pid % 400);
const prisma = createTestPrisma();

interface Identified {
  id: string;
}

describe("D1–D7 HTTP smoke", () => {
  let server: Server;
  let p = 0;
  let productId = "";
  let customerId = "";
  let supplierId = "";
  let creditSaleId = "";

  beforeAll(async () => {
    await ensureNoForeignDevServer();
    await truncateAll(prisma);
    server = startServer(port);
    p = server.port;
    await waitReady(server);
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  }, 300000);

  it("products: create + list → 201/200", async () => {
    const res = await httpPost(p, "/api/products", {
      name: "Smoke Rice",
      unit: "kg",
      costPrice: 5,
      currentPrice: 10,
    });
    expect(res.status).toBe(201);
    productId = ((await res.json()) as Identified).id;
    const list = await httpGet(p, "/api/products");
    expect(list.status).toBe(200);
  });

  it("stock: CORRECTION to 5 → 201, DAMAGE fails above stock → 409", async () => {
    const res = await httpPost(p, "/api/stock/adjustments", {
      productId,
      reason: "CORRECTION",
      quantity: 5,
      note: "opening stock",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { product: { stockQty: number } };
    expect(body.product.stockQty).toBe(5);

    const damage = await httpPost(p, "/api/stock/adjustments", {
      productId,
      reason: "DAMAGE",
      quantity: 99,
    });
    expect(damage.status).toBe(409);
    await errorBody(damage);
  });

  it("suppliers: create → 201", async () => {
    const res = await httpPost(p, "/api/suppliers", { name: "Smoke Wholesale" });
    expect(res.status).toBe(201);
    supplierId = ((await res.json()) as Identified).id;
  });

  it("purchases: CASH purchase → 201 (wallet debited at the route)", async () => {
    const res = await httpPost(p, "/api/purchases", {
      supplierId,
      paymentType: "CASH",
      items: [{ productId, quantity: 10, costPerUnit: 5 }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { total: number; items: unknown[] };
    expect(body.total).toBe(50);
    expect(body.items.length).toBe(1);
  });

  it("purchases: CREDIT purchase → 201 (supplier owes)", async () => {
    const res = await httpPost(p, "/api/purchases", {
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId, quantity: 1, costPerUnit: 5 }],
    });
    expect(res.status).toBe(201);
  });

  it("supplier-payments: partial payment → 201", async () => {
    const res = await httpPost(p, "/api/supplier-payments", {
      supplierId,
      amount: 2,
    });
    expect(res.status).toBe(201);
  });

  it("customers: create → 201", async () => {
    const res = await httpPost(p, "/api/customers", { name: "Smoke Buyer" });
    expect(res.status).toBe(201);
    customerId = ((await res.json()) as Identified).id;
  });

  it("sales: CASH 2 → 201 (deposits 20)", async () => {
    const res = await httpPost(p, "/api/sales", {
      paymentType: "CASH",
      items: [{ productId, quantity: 2 }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { total: number; items: unknown[] };
    expect(body.total).toBe(20);
    expect(body.items.length).toBe(1);
  });

  it("sales: ECASH 1 → 201 (deposits 10)", async () => {
    const res = await httpPost(p, "/api/sales", {
      paymentType: "ECASH",
      items: [{ productId, quantity: 1 }],
    });
    expect(res.status).toBe(201);
  });

  it("sales: CREDIT for the customer → 201, GET /api/sales/[id] 200", async () => {
    const res = await httpPost(p, "/api/sales", {
      paymentType: "CREDIT",
      customerId,
      items: [{ productId, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    creditSaleId = ((await res.json()) as Identified).id;

    const one = await httpGet(p, `/api/sales/${creditSaleId}`);
    expect(one.status).toBe(200);
  });

  it("sales: CREDIT without customerId → 400", async () => {
    const res = await httpPost(p, "/api/sales", {
      paymentType: "CREDIT",
      items: [{ productId, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    await errorBody(res);
  });

  it("customer-payments: pay down credit → 201 (deposits 3)", async () => {
    const res = await httpPost(p, "/api/customer-payments", {
      customerId,
      amount: 3,
    });
    expect(res.status).toBe(201);
  });

  it("reports: sales/customers/suppliers/wallet match the ledger", async () => {
    const sales = await httpGet(p, "/api/reports/sales");
    expect(sales.status).toBe(200);
    const salesBody = (await sales.json()) as { totalSales: number; numberOfSales: number };
    expect(salesBody.totalSales).toBe(40);
    expect(salesBody.numberOfSales).toBe(3);

    const customersReport = await httpGet(p, "/api/reports/customers");
    const customersBody = (await customersReport.json()) as { outstandingCredit: number };
    expect(customersBody.outstandingCredit).toBe(7);

    const suppliersReport = await httpGet(p, "/api/reports/suppliers");
    const suppliersBody = (await suppliersReport.json()) as { outstandingBalance: number };
    expect(suppliersBody.outstandingBalance).toBe(3);

    const walletReport = await httpGet(p, "/api/reports/wallet");
    const walletBody = (await walletReport.json()) as {
      deposits: number;
      withdrawals: number;
      balance: number;
    };
    expect(walletBody.deposits).toBe(33);
    expect(walletBody.withdrawals).toBe(52);
    expect(walletBody.balance).toBe(33 - 52);
  });

  it("stock movements list → 200; unknown product GET → 404", async () => {
    const movements = await httpGet(p, "/api/stock/movements");
    expect(movements.status).toBe(200);
    const rows = (await movements.json()) as unknown[];
    expect(rows.length).toBeGreaterThanOrEqual(4);

    const missing = await httpGet(p, "/api/products/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    await errorBody(missing);
  });

  it("liveness: GET /api/products → 200 after the full walk", async () => {
    const res = await httpGet(p, "/api/products");
    expect(res.status).toBe(200);
  });
});