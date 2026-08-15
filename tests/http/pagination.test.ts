// D12 HTTP pagination suite — all 8 list endpoints over real HTTP.
//
// Tests backward compatibility (no params → raw array), paginated envelope,
// cursor traversal, filters, invalid query params, and deterministic ordering.

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

const port = 4700 + (process.pid % 400);
const prisma = createTestPrisma();

const OWNER = { username: "page-owner", password: "pageownerpass", role: "OWNER" } as const;

interface Identified {
  id: string;
}

describe("D12 HTTP pagination", () => {
  let server: Server;
  let p = 0;
  let cookie = "";
  let productId = "";
  let customerId = "";
  let supplierId = "";

  beforeAll(async () => {
    await ensureNoForeignDevServer();
    await truncateAll(prisma);
    await createUserRecord(prisma, OWNER);
    server = startServer(port);
    p = server.port;
    await waitReady(server);
    await warmRoutes(p, [
      "/api/products",
      "/api/customers",
      "/api/suppliers",
      "/api/sales",
      "/api/purchases",
      "/api/supplier-payments",
      "/api/customer-payments",
      "/api/stock/movements",
      "/api/auth",
    ]);
    cookie = await signIn(p, `${OWNER.username}@erp.local`, OWNER.password);
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  }, 300000);

  // ─── Seed data ───────────────────────────────────────────────────────────

  it("seed: create product, customer, supplier, and some transactions", async () => {
    // Product
    const prodRes = await httpPost(p, "/api/products", {
      name: "Page Milk",
      unit: "pkt",
      costPrice: 30,
      currentPrice: 50,
    }, cookie);
    expect(prodRes.status).toBe(201);
    productId = ((await prodRes.json()) as Identified).id;

    // Stock correction
    const stockRes = await httpPost(p, "/api/stock/adjustments", {
      productId,
      reason: "CORRECTION",
      quantity: 20,
    }, cookie);
    expect(stockRes.status).toBe(201);

    // Customer
    const custRes = await httpPost(p, "/api/customers", {
      name: "Page Customer",
    }, cookie);
    expect(custRes.status).toBe(201);
    customerId = ((await custRes.json()) as Identified).id;

    // Supplier
    const supRes = await httpPost(p, "/api/suppliers", { name: "Page Wholesale" }, cookie);
    expect(supRes.status).toBe(201);
    supplierId = ((await supRes.json()) as Identified).id;

    // Purchase (CASH)
    const purRes = await httpPost(p, "/api/purchases", {
      supplierId,
      paymentType: "CASH",
      items: [{ productId, quantity: 5, costPerUnit: 30 }],
    }, cookie);
    expect(purRes.status).toBe(201);

    // Sale (CASH)
    const saleRes = await httpPost(p, "/api/sales", {
      paymentType: "CASH",
      items: [{ productId, quantity: 2 }],
    }, cookie);
    expect(saleRes.status).toBe(201);

    // Customer payment
    const cpayRes = await httpPost(p, "/api/customer-payments", {
      customerId,
      amount: 100,
    }, cookie);
    expect(cpayRes.status).toBe(201);

    // Supplier payment
    const spayRes = await httpPost(p, "/api/supplier-payments", {
      supplierId,
      amount: 50,
    }, cookie);
    expect(spayRes.status).toBe(201);
  });

  // ─── Backward compatibility (no params → raw array) ─────────────────────

  describe("backward compatibility — no params returns raw array", () => {
    it("GET /api/products → 200 array", async () => {
      const res = await httpGet(p, "/api/products", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/customers → 200 array", async () => {
      const res = await httpGet(p, "/api/customers", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/suppliers → 200 array", async () => {
      const res = await httpGet(p, "/api/suppliers", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/sales → 200 array", async () => {
      const res = await httpGet(p, "/api/sales", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/purchases → 200 array", async () => {
      const res = await httpGet(p, "/api/purchases", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/supplier-payments → 200 array", async () => {
      const res = await httpGet(p, "/api/supplier-payments", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/customer-payments → 200 array", async () => {
      const res = await httpGet(p, "/api/customer-payments", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/stock/movements → 200 array", async () => {
      const res = await httpGet(p, "/api/stock/movements", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // ─── Paginated envelope ─────────────────────────────────────────────────

  describe("paginated envelope — with params returns { data, paging }", () => {
    it("products: limit=1 returns envelope with data array and paging", async () => {
      const res = await httpGet(p, "/api/products?limit=1", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.paging).toBeDefined();
      expect(typeof body.paging.hasMore).toBe("boolean");
    });

    it("customers: limit=1 returns envelope", async () => {
      const res = await httpGet(p, "/api/customers?limit=1", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.paging).toBeDefined();
    });

    it("suppliers: limit=1 returns envelope", async () => {
      const res = await httpGet(p, "/api/suppliers?limit=1", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.paging).toBeDefined();
    });

    it("sales: limit=1 returns envelope", async () => {
      const res = await httpGet(p, "/api/sales?limit=1", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.paging).toBeDefined();
    });

    it("purchases: limit=1 returns envelope", async () => {
      const res = await httpGet(p, "/api/purchases?limit=1", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.paging).toBeDefined();
    });

    it("supplier-payments: limit=1 returns envelope", async () => {
      const res = await httpGet(p, "/api/supplier-payments?limit=1", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.paging).toBeDefined();
    });

    it("customer-payments: limit=1 returns envelope", async () => {
      const res = await httpGet(p, "/api/customer-payments?limit=1", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.paging).toBeDefined();
    });

    it("stock/movements: limit=1 returns envelope", async () => {
      const res = await httpGet(p, "/api/stock/movements?limit=1", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.paging).toBeDefined();
    });
  });

  // ─── Cursor traversal ───────────────────────────────────────────────────

  describe("cursor traversal", () => {
    it("products: paginate through all items with cursor", async () => {
      // Create a second product to ensure we have >1 for cursor traversal
      const prod2 = await httpPost(p, "/api/products", {
        name: "Page Bread",
        unit: "pcs",
        costPrice: 20,
        currentPrice: 35,
      }, cookie);
      expect(prod2.status).toBe(201);

      const page1 = await httpGet(p, "/api/products?limit=1", cookie);
      const body1 = await page1.json() as { data: { id: string }[]; paging: { next: string | null; hasMore: boolean } };

      expect(body1.data.length).toBe(1);
      expect(body1.paging.hasMore).toBe(true);
      expect(body1.paging.next).not.toBeNull();

      const page2 = await httpGet(p, `/api/products?limit=1&cursor=${body1.paging.next}`, cookie);
      const body2 = await page2.json() as { data: { id: string }[]; paging: { next: string | null; hasMore: boolean } };

      expect(body2.data.length).toBe(1);
      expect(body2.data[0].id).not.toBe(body1.data[0].id);
    });
  });

  // ─── Filters ────────────────────────────────────────────────────────────

  describe("filters", () => {
    it("products: search filters by name", async () => {
      const res = await httpGet(p, "/api/products?search=Milk", cookie);
      const body = await res.json() as { data: { name: string }[] } | { name: string }[];

      // Could be array (no params beyond search) or envelope
      const items = Array.isArray(body) ? body : body.data;
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0].name).toContain("Milk");
    });

    it("products: category filter", async () => {
      const res = await httpGet(p, "/api/products?category=dairy", cookie);
      expect(res.status).toBe(200);
    });

    it("sales: paymentType filter", async () => {
      const res = await httpGet(p, "/api/sales?paymentType=CASH", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { paymentType: string }[] } | { paymentType: string }[];
      const items = Array.isArray(body) ? body : body.data;
      for (const item of items) {
        expect(item.paymentType).toBe("CASH");
      }
    });

    it("purchases: supplierId filter", async () => {
      const res = await httpGet(p, `/api/purchases?supplierId=${supplierId}`, cookie);
      expect(res.status).toBe(200);
    });

    it("stock/movements: productId filter (existing behavior)", async () => {
      const res = await httpGet(p, `/api/stock/movements?productId=${productId}`, cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      const items = Array.isArray(body) ? body : body.data;
      for (const item of items) {
        expect(item.productId).toBe(productId);
      }
    });

    it("stock/movements: reason filter with pagination", async () => {
      const res = await httpGet(p, "/api/stock/movements?reason=PURCHASE&limit=10", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { reason: string }[] };
      expect(body.data).toBeDefined();
      for (const item of body.data) {
        expect(item.reason).toBe("PURCHASE");
      }
    });
  });

  // ─── Invalid query parameters ───────────────────────────────────────────

  describe("invalid query parameters", () => {
    it("products: invalid limit → 400", async () => {
      const res = await httpGet(p, "/api/products?limit=abc", cookie);
      expect(res.status).toBe(400);
      await errorBody(res);
    });

    it("products: negative limit → 400", async () => {
      const res = await httpGet(p, "/api/products?limit=-1", cookie);
      expect(res.status).toBe(400);
      await errorBody(res);
    });

    it("products: invalid cursor → 400", async () => {
      const res = await httpGet(p, "/api/products?cursor=!!!invalid!!!", cookie);
      expect(res.status).toBe(400);
      await errorBody(res);
    });

    it("sales: invalid limit → 400", async () => {
      const res = await httpGet(p, "/api/sales?limit=0", cookie);
      expect(res.status).toBe(400);
      await errorBody(res);
    });

    it("stock/movements: invalid cursor → 400", async () => {
      const res = await httpGet(p, "/api/stock/movements?cursor=bad", cookie);
      expect(res.status).toBe(400);
      await errorBody(res);
    });
  });

  // ─── Limit clamping ─────────────────────────────────────────────────────

  describe("limit clamping", () => {
    it("products: limit=9999 clamped to 500", async () => {
      const res = await httpGet(p, "/api/products?limit=9999", cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; paging: { next: string | null; hasMore: boolean } };
      // We have 2 products (seed + cursor test), limit is clamped to 500 so all fit
      expect(body.data.length).toBe(2);
      expect(body.paging.hasMore).toBe(false);
    });
  });

  // ─── Deterministic ordering ─────────────────────────────────────────────

  describe("deterministic ordering", () => {
    it("products: returns items in createdAt DESC order", async () => {
      const res = await httpGet(p, "/api/products?limit=10", cookie);
      const body = await res.json() as { data: { createdAt: string }[] };
      const dates = body.data.map((item) => new Date(item.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    });

    it("sales: returns items in date DESC order", async () => {
      const res = await httpGet(p, "/api/sales?limit=10", cookie);
      const body = await res.json() as { data: { date: string }[] };
      const dates = body.data.map((item) => new Date(item.date).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    });
  });
});
