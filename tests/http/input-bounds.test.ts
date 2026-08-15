// F-04 HTTP integration suite (input upper bounds).
//
// Spawns a real Next.js dev server against the dedicated `erp_retail_test`
// database and verifies over real HTTP that over-limit numeric inputs are
// rejected with 400 at the request boundary (ValidationError) — never a 500,
// never a crash — while boundary-maximum values still succeed.
//
// The key acceptance criterion: the documented F-04 DoS payload
// (`items[0].quantity: 1e8`, which previously drove calculatePrice's
// `new Array(qty + 1)` ~800 MB allocation) must now return 400 immediately,
// proving validation rejects it before calculatePrice is ever reached.
//
// F-10: the routes are guarded, so the suite signs in as a seeded OWNER and
// threads the session cookie through every request.
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
  signIn,
  startServer,
  stopServer,
  waitReady,
  warmRoutes,
  type Server,
} from "../helpers/http";
import { createServerPrisma } from "../helpers/http";
import { truncateAll } from "../helpers/db";
import { createUserRecord } from "../helpers/auth";
import { MAX_AMOUNT, MAX_ITEM_QUANTITY, MAX_ITEMS_PER_DOCUMENT } from "../../lib/bounds";

const PORT = 4600 + (process.pid % 400);
const prisma = createServerPrisma();

const OWNER = { username: "bounds-owner", password: "boundsownerpass", role: "OWNER" } as const;

const itemsOfLength = (n: number) =>
  Array.from({ length: n }, () => ({ productId: "p-seed", quantity: 1 }));

describe("HTTP input upper bounds (F-04)", () => {
  let server: Server;
  let port = 0;
  let cookie = "";
  let seededProductId = "";

  beforeAll(async () => {
    await ensureNoForeignDevServer();
    await truncateAll(prisma);
    await createUserRecord(prisma, OWNER);
    server = startServer(PORT);
    port = server.port;
    await waitReady(server);
    await warmRoutes(port, [
      "/api/products",
      "/api/sales",
      "/api/purchases",
      "/api/customer-payments",
      "/api/supplier-payments",
      "/api/stock/adjustments",
    ]);
    cookie = await signIn(port, `${OWNER.username}@erp.local`, OWNER.password);
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  }, 300000);

  // ── Over-limit rejection (400, no crash, no allocate) ─────────────────────
  it("sale: documented F-04 DoS payload quantity=1e8 → 400", async () => {
    const started = Date.now();
    const res = await httpPost(port, "/api/sales", {
      paymentType: "CASH",
      items: [{ productId: "p-seed", quantity: 100000000 }],
    }, cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/quantity must be at most 100000/);
    expect(Date.now() - started).toBeLessThan(15000);
  });

  it("sale: quantity MAX+1 → 400", async () => {
    const res = await httpPost(port, "/api/sales", {
      paymentType: "CASH",
      items: [{ productId: "p-seed", quantity: MAX_ITEM_QUANTITY + 1 }],
    }, cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/at most 100000/);
  });

  it("sale: 101 items → 400", async () => {
    const res = await httpPost(port, "/api/sales", {
      paymentType: "CASH",
      items: itemsOfLength(MAX_ITEMS_PER_DOCUMENT + 1),
    }, cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/at most 100 entries/);
  });

  it("purchase: costPerUnit MAX+1 → 400", async () => {
    const res = await httpPost(port, "/api/purchases", {
      supplierId: "s-seed",
      paymentType: "CASH",
      items: [{ productId: "p-seed", quantity: 1, costPerUnit: MAX_AMOUNT + 1 }],
    }, cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/costPerUnit must be at most 10000000/);
  });

  it("customer-payment: amount MAX+1 → 400", async () => {
    const res = await httpPost(port, "/api/customer-payments", {
      customerId: "c-seed",
      amount: MAX_AMOUNT + 1,
    }, cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/amount must be at most 10000000/);
  });

  it("supplier-payment: amount MAX+1 → 400", async () => {
    const res = await httpPost(port, "/api/supplier-payments", {
      supplierId: "s-seed",
      amount: MAX_AMOUNT + 1,
    }, cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/amount must be at most 10000000/);
  });

  it("stock: DAMAGE quantity MAX+1 → 400", async () => {
    const res = await httpPost(port, "/api/stock/adjustments", {
      productId: "p-seed",
      reason: "DAMAGE",
      quantity: MAX_ITEM_QUANTITY + 1,
    }, cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/quantity must be at most 100000/);
  });

  it("product: currentPrice MAX+1 → 400", async () => {
    const res = await httpPost(port, "/api/products", {
      name: "Leak",
      unit: "pcs",
      costPrice: 1,
      currentPrice: MAX_AMOUNT + 1,
    }, cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/currentPrice must be at most 10000000/);
  });

  // ── Boundary values still succeed through the full stack ──────────────────
  it("boundary: create product + CORRECTION to MAX stock → 201s", async () => {
    const product = await httpPost(port, "/api/products", {
      name: "Boundary Bulk",
      unit: "kg",
      costPrice: 100,
      currentPrice: 120,
    }, cookie);
    expect(product.status).toBe(201);
    seededProductId = ((await product.json()) as { id: string }).id;

    const correction = await httpPost(port, "/api/stock/adjustments", {
      productId: seededProductId,
      reason: "CORRECTION",
      quantity: MAX_ITEM_QUANTITY,
      note: "test seed to boundary",
    }, cookie);
    expect(correction.status).toBe(201);
  });

  it("boundary: sale of MAX quantity → 201 (cap never binds legit data)", async () => {
    const res = await httpPost(port, "/api/sales", {
      paymentType: "CASH",
      items: [{ productId: seededProductId, quantity: MAX_ITEM_QUANTITY }],
    }, cookie);
    expect(res.status).toBe(201);
  });

  // ── P3: route identifier format validation ────────────────────────────────
  it("P3: malformed entity id in path → 400, not 500", async () => {
    const res = await httpGet(port, "/api/products/not-a-uuid", cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/Invalid id format/);
  });

  it("P3: malformed user id in path → 400, not 500", async () => {
    const res = await httpGet(port, "/api/users/not-a-uuid", cookie);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.message).toMatch(/Invalid id format/);
  });

  // ── Liveness: the app never crashed under hostile input ────────────────────
  it("liveness: GET /api/products → 200 after all hostile requests", async () => {
    const res = await httpGet(port, "/api/products", cookie);
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });
});
