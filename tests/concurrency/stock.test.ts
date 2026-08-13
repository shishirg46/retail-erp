// F-02 concurrency regression suite (Vitest).
//
// Proves that concurrent stock consumption (SALE / DAMAGE) cannot oversell or
// drive stock below zero, and that the D6 reconciliation invariant
// (Product.stockQty == Σ StockMovement.qtyChange) always holds afterwards.
//
// Real races are created in-code with Promise.allSettled (never by running
// tests concurrently) and always run ONLY against the dedicated test database
// (TEST_DATABASE_URL guard in tests/helpers/db.ts).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InsufficientStockError } from "../../lib/errors";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PrismaStockRepository } from "../../modules/stock/stock.repository";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { SaleService } from "../../modules/sales/sale.service";
import { StockService } from "../../modules/stock/stock.service";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { createTestPrisma, truncateAll } from "../helpers/db";

const prisma = createTestPrisma();

const productRepository = new PrismaProductRepository(prisma);
const stockRepository = new PrismaStockRepository(prisma);
const saleService = new SaleService(prisma);
const stockService = new StockService(prisma);
const purchaseService = new PurchaseService(prisma);

async function createProduct(name: string): Promise<string> {
  const product = await productRepository.create({
    name,
    unit: "pcs",
    costPrice: 10,
    currentPrice: 20,
  });
  return product.id;
}

// Set an opening stock level via CORRECTION (D6): the movement audit trail
// stays consistent so stockQty == Σ movements can be asserted afterwards.
async function seedStock(productId: string, target: number): Promise<void> {
  await stockService.adjustStock({
    productId,
    reason: "CORRECTION",
    quantity: target,
    note: "test seed",
  });
}

async function movementSum(productId: string): Promise<number> {
  const movements = await stockRepository.listByProduct(productId);
  return movements.reduce((sum, m) => sum + m.qtyChange, 0);
}

function isInsufficient(error: unknown): boolean {
  return error instanceof InsufficientStockError;
}

describe("F-02 stock concurrency", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Scenario 1: two parallel SALE on the last unit ────────────────────────
  it("S1: two parallel sales on last unit", async () => {
    const id = await createProduct("S1 two sales on last unit");
    await seedStock(id, 1);

    const results = await Promise.allSettled([
      saleService.createSale({
        paymentType: "CASH",
        items: [{ productId: id, quantity: 1 }],
      }),
      saleService.createSale({
        paymentType: "CASH",
        items: [{ productId: id, quantity: 1 }],
      }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const err = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(err.length).toBe(1);
    expect(isInsufficient(err[0].reason)).toBe(true);

    const product = await productRepository.findById(id);
    expect(product!.stockQty).toBe(0);
    expect(await movementSum(id)).toBe(0);

    expect(await prisma.sale.count()).toBe(1);
    expect(await prisma.saleItem.count()).toBe(1);
    expect(await prisma.walletTransaction.count()).toBe(1);
  });

  // ── Scenario 2: ten parallel SALE on stock of 5 ───────────────────────────
  it("S2: ten parallel sales on stock of 5", async () => {
    const id = await createProduct("S2 ten sales on stock 5");
    await seedStock(id, 5);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        saleService.createSale({
          paymentType: "CASH",
          items: [{ productId: id, quantity: 1 }],
        })
      )
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const err = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(5);
    expect(err.length).toBe(5);
    expect(err.every((r) => isInsufficient(r.reason))).toBe(true);

    const product = await productRepository.findById(id);
    expect(product!.stockQty).toBe(0);
    expect(await movementSum(id)).toBe(0);

    expect(await prisma.sale.count()).toBe(5);
    expect(await prisma.walletTransaction.count()).toBe(5);
  });

  // ── Scenario 3: two parallel DAMAGE on stock of 2 ─────────────────────────
  it("S3: two parallel DAMAGE on stock of 2", async () => {
    const id = await createProduct("S3 two damages on stock 2");
    await seedStock(id, 2);

    const before = {
      customers: await prisma.customer.count(),
      suppliers: await prisma.supplier.count(),
      wallets: await prisma.walletTransaction.count(),
    };

    const results = await Promise.allSettled([
      stockService.adjustStock({ productId: id, reason: "DAMAGE", quantity: 2 }),
      stockService.adjustStock({ productId: id, reason: "DAMAGE", quantity: 2 }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const err = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(err.length).toBe(1);
    expect(isInsufficient(err[0].reason)).toBe(true);

    const product = await productRepository.findById(id);
    expect(product!.stockQty).toBe(0);
    expect(await movementSum(id)).toBe(0);

    expect(await prisma.customer.count()).toBe(before.customers);
    expect(await prisma.supplier.count()).toBe(before.suppliers);
    expect(await prisma.walletTransaction.count()).toBe(before.wallets);
  });

  // ── Scenario 4: parallel SALE + DAMAGE on the last unit ───────────────────
  it("S4: parallel SALE + DAMAGE on last unit", async () => {
    const id = await createProduct("S4 sale vs damage on last unit");
    await seedStock(id, 1);

    const results = await Promise.allSettled([
      saleService.createSale({
        paymentType: "CASH",
        items: [{ productId: id, quantity: 1 }],
      }),
      stockService.adjustStock({ productId: id, reason: "DAMAGE", quantity: 1 }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const err = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(err.length).toBe(1);
    expect(isInsufficient(err[0].reason)).toBe(true);

    const product = await productRepository.findById(id);
    expect(product!.stockQty).toBe(0);
    expect(await movementSum(id)).toBe(0);

    const reasons = await prisma.stockMovement.findMany({
      where: { productId: id, reason: { in: ["SALE", "DAMAGE"] } },
    });
    expect(reasons.length).toBe(1);
  });

  // ── Scenario 5: sell-out then purchase (replenishment sanity) ─────────────
  it("S5: sell-out then purchase", async () => {
    const id = await createProduct("S5 sell-out then purchase");
    await seedStock(id, 1);

    await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: id, quantity: 1 }],
    });

    const supplier = await new PrismaSupplierRepository(prisma).create({
      name: "Test Wholesale",
    });

    await purchaseService.createPurchase({
      supplierId: supplier.id,
      paymentType: "CASH",
      items: [{ productId: id, quantity: 5, costPerUnit: 12 }],
    });

    const product = await productRepository.findById(id);
    expect(product!.stockQty).toBe(5);
    expect(product!.costPrice).toBe(12);
    expect(await movementSum(id)).toBe(5);
  });
});