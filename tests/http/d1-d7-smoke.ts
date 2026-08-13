// D1–D7 HTTP smoke suite — the full API surface over real HTTP.
//
// Spawns a real Next.js dev server bound to the dedicated `erp_retail_test`
// database (guard-verified) and walks every write + read route: products,
// stock adjustments, purchases, supplier payments, customers, customer
// payments, sales (CASH/ECASH/CREDIT), report reads, and 404/400 failure
// paths. Proves the routes stay wired and the D1–D7 responses well-formed
// end to end, on top of the service-level integration suites.

import "dotenv/config";
import { strict as assert } from "node:assert";
import {
  ensureNoForeignDevServer,
  errorBody,
  httpGet,
  httpPost,
  startServer,
  stopServer,
  waitReady,
} from "../helpers/http";
import { createTestPrisma, truncateAll } from "../helpers/db";

const port = 4700 + (process.pid % 400);
const prisma = createTestPrisma();

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

interface Identified {
  id: string;
}

let productId = "";
let customerId = "";
let supplierId = "";
let creditSaleId = "";

async function main(): Promise<void> {
  const server = startServer(port);

  try {
    await ensureNoForeignDevServer();
    await truncateAll(prisma);
    await waitReady(server);
    const p = server.port;

    await test("products: create + list → 201/200", async () => {
      const res = await httpPost(p, "/api/products", {
        name: "Smoke Rice",
        unit: "kg",
        costPrice: 5,
        currentPrice: 10,
      });
      assert.equal(res.status, 201);
      productId = ((await res.json()) as Identified).id;
      const list = await httpGet(p, "/api/products");
      assert.equal(list.status, 200);
    });

    await test("stock: CORRECTION to 5 → 201, DAMAGE fails above stock → 409", async () => {
      const res = await httpPost(p, "/api/stock/adjustments", {
        productId,
        reason: "CORRECTION",
        quantity: 5,
        note: "opening stock",
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { product: { stockQty: number } };
      assert.equal(body.product.stockQty, 5);

      const damage = await httpPost(p, "/api/stock/adjustments", {
        productId,
        reason: "DAMAGE",
        quantity: 99,
      });
      assert.equal(damage.status, 409);
      await errorBody(damage);
    });

    await test("suppliers: create → 201", async () => {
      const res = await httpPost(p, "/api/suppliers", { name: "Smoke Wholesale" });
      assert.equal(res.status, 201);
      supplierId = ((await res.json()) as Identified).id;
    });

    await test("purchases: CASH purchase → 201 (wallet debited at the route)", async () => {
      const res = await httpPost(p, "/api/purchases", {
        supplierId,
        paymentType: "CASH",
        items: [{ productId, quantity: 10, costPerUnit: 5 }],
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { total: number; items: unknown[] };
      assert.equal(body.total, 50);
      assert.equal(body.items.length, 1);
    });

    await test("purchases: CREDIT purchase → 201 (supplier owes)", async () => {
      const res = await httpPost(p, "/api/purchases", {
        supplierId,
        paymentType: "CREDIT",
        items: [{ productId, quantity: 1, costPerUnit: 5 }],
      });
      assert.equal(res.status, 201);
    });

    await test("supplier-payments: partial payment → 201", async () => {
      const res = await httpPost(p, "/api/supplier-payments", {
        supplierId,
        amount: 2,
      });
      assert.equal(res.status, 201);
    });

    await test("customers: create → 201", async () => {
      const res = await httpPost(p, "/api/customers", { name: "Smoke Buyer" });
      assert.equal(res.status, 201);
      customerId = ((await res.json()) as Identified).id;
    });

    await test("sales: CASH 2 → 201 (deposits 20)", async () => {
      const res = await httpPost(p, "/api/sales", {
        paymentType: "CASH",
        items: [{ productId, quantity: 2 }],
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { total: number; items: unknown[] };
      assert.equal(body.total, 20);
      assert.equal(body.items.length, 1);
    });

    await test("sales: ECASH 1 → 201 (deposits 10)", async () => {
      const res = await httpPost(p, "/api/sales", {
        paymentType: "ECASH",
        items: [{ productId, quantity: 1 }],
      });
      assert.equal(res.status, 201);
    });

    await test("sales: CREDIT for the customer → 201, GET /api/sales/[id] 200", async () => {
      const res = await httpPost(p, "/api/sales", {
        paymentType: "CREDIT",
        customerId,
        items: [{ productId, quantity: 1 }],
      });
      assert.equal(res.status, 201);
      creditSaleId = ((await res.json()) as Identified).id;

      const one = await httpGet(p, `/api/sales/${creditSaleId}`);
      assert.equal(one.status, 200);
    });

    await test("sales: CREDIT without customerId → 400", async () => {
      const res = await httpPost(p, "/api/sales", {
        paymentType: "CREDIT",
        items: [{ productId, quantity: 1 }],
      });
      assert.equal(res.status, 400);
      await errorBody(res);
    });

    await test("customer-payments: pay down credit → 201 (deposits 3)", async () => {
      const res = await httpPost(p, "/api/customer-payments", {
        customerId,
        amount: 3,
      });
      assert.equal(res.status, 201);
    });

    await test("reports: sales/customers/suppliers/wallet match the ledger", async () => {
      const sales = await httpGet(p, "/api/reports/sales");
      assert.equal(sales.status, 200);
      const salesBody = (await sales.json()) as { totalSales: number; numberOfSales: number };
      assert.equal(salesBody.totalSales, 40, "20 CASH + 10 ECASH + 10 CREDIT");
      assert.equal(salesBody.numberOfSales, 3);

      const customersReport = await httpGet(p, "/api/reports/customers");
      const customersBody = (await customersReport.json()) as { outstandingCredit: number };
      assert.equal(customersBody.outstandingCredit, 7, "10 credit sale - 3 payment");

      const suppliersReport = await httpGet(p, "/api/reports/suppliers");
      const suppliersBody = (await suppliersReport.json()) as { outstandingBalance: number };
      assert.equal(suppliersBody.outstandingBalance, 3, "5 credit purchase - 2 payment");

      const walletReport = await httpGet(p, "/api/reports/wallet");
      const walletBody = (await walletReport.json()) as {
        deposits: number;
        withdrawals: number;
        balance: number;
      };
      assert.equal(walletBody.deposits, 33, "20 + 10 + 3");
      assert.equal(walletBody.withdrawals, 52, "50 CASH purchase + 2 supplier payment");
      assert.equal(walletBody.balance, 33 - 52);
    });

    await test("stock movements list → 200; unknown product GET → 404", async () => {
      const movements = await httpGet(p, "/api/stock/movements");
      assert.equal(movements.status, 200);
      const rows = (await movements.json()) as unknown[];
      assert.ok(rows.length >= 4, "seed + purchases + sales movements present");

      const missing = await httpGet(p, "/api/products/00000000-0000-0000-0000-000000000000");
      assert.equal(missing.status, 404);
      await errorBody(missing);
    });

    await test("liveness: GET /api/products → 200 after the full walk", async () => {
      const res = await httpGet(p, "/api/products");
      assert.equal(res.status, 200);
    });
  } catch (error) {
    failed++;
    console.error("HARNESS FAIL");
    console.error(error);
  } finally {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();