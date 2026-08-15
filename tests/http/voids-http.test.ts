// M18 / D18 void HTTP suite — OWNER-only void endpoints over a real server.
//
// Spawns a real Next.js dev server bound to the dedicated `erp_retail_test`
// database (guard-verified), signs in an OWNER and a CASHIER over Better Auth,
// and walks the five void routes end to end:
//   - D18.1: CASHIER → 403 on every void endpoint; unauthenticated → 401
//   - OWNER voids a sale / purchase / credit payment / supplier payment /
//     stock movement and gets a VoidRecord back
//   - D18.9: the GET responses for the affected records carry
//     status/voidedAt/voidReason
//   - D18.8: reports drop the voided activity over HTTP
//   - double void → 409, malformed body → 400

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

const port = 4900 + (process.pid % 400);
const prisma = createTestPrisma();

const OWNER = { username: "void-owner", password: "voidownerpass", role: "OWNER" } as const;
const CASHIER = { username: "void-cashier", password: "voidcashierpass", role: "CASHIER" } as const;

interface Identified {
  id: string;
}
interface VoidReply {
  voidId: string;
  targetId: string;
  reason: string;
}

describe("voids over HTTP (M18/D18)", () => {
  let server: Server;
  let p = 0;
  let ownerCookie = "";
  let cashierCookie = "";
  let productId = "";
  let customerId = "";
  let supplierId = "";
  let cashSaleId = "";
  let creditSaleId = "";
  let purchaseId = "";
  let customerPaymentId = "";
  let supplierPaymentId = "";
  let movementId = "";

  const voidBody = { reason: "owner decision" };

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
      "/api/stock/movements",
      "/api/suppliers",
      "/api/purchases",
      "/api/supplier-payments",
      "/api/customers",
      "/api/sales",
      "/api/customer-payments",
      "/api/reports/sales",
      "/api/reports/wallet",
      "/api/sales/void",
      "/api/purchases/void",
      "/api/customer-payments/void",
      "/api/supplier-payments/void",
      "/api/stock/movements/void",
    ]);
    ownerCookie = await signIn(p, `${OWNER.username}@erp.local`, OWNER.password);
    cashierCookie = await signIn(p, `${CASHIER.username}@erp.local`, CASHIER.password);
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  }, 300000);

  // ── Fixtures (one product + one of every transaction) ─────────────────────
  it("fixtures: product, stock, supplier, purchase, customer, sales, payments", async () => {
    const product = await httpPost(p, "/api/products", {
      name: "Void Rice", unit: "kg", costPrice: 5, currentPrice: 10,
    }, ownerCookie);
    expect(product.status).toBe(201);
    productId = ((await product.json()) as Identified).id;

    await httpPost(p, "/api/stock/adjustments", {
      productId, reason: "CORRECTION", quantity: 30, note: "opening",
    }, ownerCookie);

    const supplier = await httpPost(p, "/api/suppliers", { name: "Void Mill" }, ownerCookie);
    supplierId = ((await supplier.json()) as Identified).id;

    const purchase = await httpPost(p, "/api/purchases", {
      supplierId, paymentType: "CASH",
      items: [{ productId, quantity: 10, costPerUnit: 5 }],
    }, ownerCookie);
    expect(purchase.status).toBe(201);
    purchaseId = ((await purchase.json()) as Identified).id;

    const customer = await httpPost(p, "/api/customers", { name: "Void Buyer" }, ownerCookie);
    customerId = ((await customer.json()) as Identified).id;

    const cashSale = await httpPost(p, "/api/sales", {
      paymentType: "CASH", items: [{ productId, quantity: 2 }],
    }, ownerCookie);
    expect(cashSale.status).toBe(201);
    cashSaleId = ((await cashSale.json()) as Identified).id;

    const creditSale = await httpPost(p, "/api/sales", {
      paymentType: "CREDIT", customerId, items: [{ productId, quantity: 1 }],
    }, ownerCookie);
    expect(creditSale.status).toBe(201);
    creditSaleId = ((await creditSale.json()) as Identified).id;

    const cp = await httpPost(p, "/api/customer-payments", { customerId, amount: 5 }, ownerCookie);
    expect(cp.status).toBe(201);
    customerPaymentId = ((await cp.json()) as Identified).id;

    const sp = await httpPost(p, "/api/supplier-payments", { supplierId, amount: 5 }, ownerCookie);
    expect(sp.status).toBe(201);
    supplierPaymentId = ((await sp.json()) as Identified).id;

    const movements = await httpGet(p, `/api/stock/movements?productId=${productId}`, ownerCookie);
    const rows = (await movements.json()) as { id: string; reason: string }[];
    movementId = rows.find((m) => m.reason === "CORRECTION")!.id;
  });

  // ── Authorization (D18.1) ─────────────────────────────────────────────────
  it("CASHIER is forbidden (403) from every void endpoint", async () => {
    for (const path of [
      `/api/sales/${cashSaleId}/void`,
      `/api/purchases/${purchaseId}/void`,
      `/api/customer-payments/${customerPaymentId}/void`,
      `/api/supplier-payments/${supplierPaymentId}/void`,
      `/api/stock/movements/${movementId}/void`,
    ]) {
      const res = await httpPost(p, path, voidBody, cashierCookie);
      expect(res.status, path).toBe(403);
      await errorBody(res);
    }
  });

  it("unauthenticated requests are rejected (401)", async () => {
    const res = await httpPost(p, `/api/sales/${cashSaleId}/void`, voidBody);
    expect(res.status).toBe(401);
  });

  it("malformed void body -> 400", async () => {
    const res = await httpPost(p, `/api/sales/${cashSaleId}/void`, { reason: "  " }, ownerCookie);
    expect(res.status).toBe(400);
    await errorBody(res);
  });

  // ── Owner voids + status exposure (D18.9) ─────────────────────────────────
  it("owner voids the CASH sale: reply + GET sale shows status VOIDED", async () => {
    const res = await httpPost(p, `/api/sales/${cashSaleId}/void`, voidBody, ownerCookie);
    expect(res.status).toBe(200);
    const reply = (await res.json()) as VoidReply;
    expect(reply.targetId).toBe(cashSaleId);
    expect(reply.reason).toBe("owner decision");

    const one = await httpGet(p, `/api/sales/${cashSaleId}`, ownerCookie);
    expect(one.status).toBe(200);
    const body = (await one.json()) as {
      status: string; voidedAt: string | null; voidReason: string | null;
    };
    expect(body.status).toBe("VOIDED");
    expect(body.voidedAt).not.toBeNull();
    expect(body.voidReason).toBe("owner decision");

    const list = await httpGet(p, "/api/sales", ownerCookie);
    const sales = (await list.json()) as { status: string }[];
    const byStatus = (s: string): number => sales.filter((x) => x.status === s).length;
    expect(byStatus("VOIDED")).toBe(1);
    expect(byStatus("ACTIVE")).toBe(1);
  });

  it("owner voids the purchase: GET /api/purchases/[id] shows status VOIDED", async () => {
    const res = await httpPost(p, `/api/purchases/${purchaseId}/void`, voidBody, ownerCookie);
    expect(res.status).toBe(200);

    const one = await httpGet(p, `/api/purchases/${purchaseId}`, ownerCookie);
    expect(one.status).toBe(200);
    const body = (await one.json()) as { status: string; voidReason: string | null };
    expect(body.status).toBe("VOIDED");
    expect(body.voidReason).toBe("owner decision");
  });

  it("owner voids the credit payment: list shows status VOIDED", async () => {
    const res = await httpPost(
      p, `/api/customer-payments/${customerPaymentId}/void`, voidBody, ownerCookie
    );
    expect(res.status).toBe(200);

    const list = await httpGet(p, "/api/customer-payments", ownerCookie);
    const payments = (await list.json()) as { id: string; status: string }[];
    expect(payments.find((x) => x.id === customerPaymentId)!.status).toBe("VOIDED");
  });

  it("owner voids the supplier payment: list shows status VOIDED", async () => {
    const res = await httpPost(
      p, `/api/supplier-payments/${supplierPaymentId}/void`, voidBody, ownerCookie
    );
    expect(res.status).toBe(200);

    const list = await httpGet(p, "/api/supplier-payments", ownerCookie);
    const payments = (await list.json()) as { id: string; status: string }[];
    expect(payments.find((x) => x.id === supplierPaymentId)!.status).toBe("VOIDED");
  });

  it("owner voids a CORRECTION movement: list shows status VOIDED", async () => {
    // Isolated product so the reversal's stock requirement is unambiguous.
    const product = await httpPost(p, "/api/products", {
      name: "Void Movement", unit: "pcs", costPrice: 2, currentPrice: 4,
    }, ownerCookie);
    const pid = ((await product.json()) as Identified).id;

    await httpPost(p, "/api/stock/adjustments", {
      productId: pid, reason: "CORRECTION", quantity: 10, note: "isolated",
    }, ownerCookie);
    const before = await httpGet(p, `/api/stock/movements?productId=${pid}`, ownerCookie);
    const rows = (await before.json()) as { id: string; reason: string }[];
    const mid = rows.find((m) => m.reason === "CORRECTION")!.id;

    const res = await httpPost(p, `/api/stock/movements/${mid}/void`, voidBody, ownerCookie);
    expect(res.status).toBe(200);

    const list = await httpGet(p, `/api/stock/movements?productId=${pid}`, ownerCookie);
    const after = (await list.json()) as { id: string; status: string }[];
    expect(after.find((m) => m.id === mid)!.status).toBe("VOIDED");
  });

  it("a voided sale cannot be voided again (409)", async () => {
    const res = await httpPost(p, `/api/sales/${cashSaleId}/void`, voidBody, ownerCookie);
    expect(res.status).toBe(409);
    await errorBody(res);
  });

  // ── Reports exclude voided activity (D18.8) ───────────────────────────────
  it("reports drop the voided sale", async () => {
    const sales = await httpGet(p, "/api/reports/sales", ownerCookie);
    const body = (await sales.json()) as { totalSales: number; numberOfSales: number };
    // Two sales were made; one CASH (20) was voided. Only the CREDIT sale (10)
    // remains — credit does not enter totalSales until paid.
    expect(body.numberOfSales).toBe(1);
    expect(body.totalSales).toBe(10);

    // The surviving CREDIT sale is still ACTIVE.
    const credit = await httpGet(p, `/api/sales/${creditSaleId}`, ownerCookie);
    expect(((await credit.json()) as { status: string }).status).toBe("ACTIVE");

    const wallet = await httpGet(p, "/api/reports/wallet", ownerCookie);
    const walletBody = (await wallet.json()) as {
      bySource: { source: string }[]; balance: number;
    };
    expect(walletBody.bySource.some((g) => g.source === "VOID")).toBe(false);
  });
});
