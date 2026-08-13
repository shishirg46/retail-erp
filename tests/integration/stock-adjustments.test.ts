// D6 stock-adjustment integration suite — DAMAGE / CORRECTION semantics (Vitest).
//
//   DAMAGE      : quantity = amount ruined  -> movement -quantity
//   CORRECTION  : quantity = desired level   -> movement target - current
//   A result below zero is rejected with 409 before any write.
//   DAMAGE/CORRECTION never touch wallet, customer, or supplier records.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InsufficientStockError,
  NotFoundError,
} from "../../lib/errors";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { StockService } from "../../modules/stock/stock.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, seedStock } from "../helpers/seed";

const prisma = createTestPrisma();
const stockService = new StockService(prisma);
const productRepository = new PrismaProductRepository(prisma);

async function expectError(
  fn: () => Promise<unknown>,
  ctor: new (...args: never[]) => Error,
  pattern?: RegExp
): Promise<void> {
  let threw: unknown;
  try {
    await fn();
  } catch (error) {
    threw = error;
  }
  expect(threw).toBeInstanceOf(ctor);
  if (pattern) expect((threw as Error).message).toMatch(pattern);
}

async function lastMovement(productId: string) {
  const rows = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { date: "asc" },
  });
  return rows[rows.length - 1];
}

describe("stock adjustments (D6)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("A1 DAMAGE: stock -qty, signed movement, no side effects", async () => {
    const product = await createProduct(prisma, { name: "A1 Sugar", unit: "kg", costPrice: 30, currentPrice: 40 });
    await seedStock(prisma, product.id, 10);

    const before = {
      customers: await prisma.customer.count(),
      suppliers: await prisma.supplier.count(),
      wallet: await prisma.walletTransaction.count(),
    };

    const result = await stockService.adjustStock({
      productId: product.id,
      reason: "DAMAGE",
      quantity: 3,
      note: "burst bag",
    });

    expect(result.product.stockQty).toBe(7);
    expect(result.movement.qtyChange).toBe(-3);

    expect(
      { customers: await prisma.customer.count(), suppliers: await prisma.supplier.count(), wallet: await prisma.walletTransaction.count() }
    ).toEqual(before);
  });

  it("A2 CORRECTION up: movement target - current", async () => {
    const product = await createProduct(prisma, { name: "A2 Oil", unit: "liter", costPrice: 90, currentPrice: 100 });
    await seedStock(prisma, product.id, 10);

    const result = await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: 25,
    });
    expect(result.product.stockQty).toBe(25);
    expect(result.movement.qtyChange).toBe(15);
  });

  it("A3 CORRECTION down: movement target - current (negative)", async () => {
    const product = await createProduct(prisma, { name: "A3 Biscuits", unit: "pcs", costPrice: 5, currentPrice: 8 });
    await seedStock(prisma, product.id, 30);

    const result = await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: 4,
    });
    expect(result.product.stockQty).toBe(4);
    expect(result.movement.qtyChange).toBe(-26);
  });

  it("A4 CORRECTION to the same level creates a zero movement", async () => {
    const product = await createProduct(prisma, { name: "A4 Static", unit: "pcs", costPrice: 2, currentPrice: 4 });
    await seedStock(prisma, product.id, 7);

    const result = await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: 7,
    });
    expect(result.product.stockQty).toBe(7);
    expect(result.movement.qtyChange).toBe(0);
    expect(result.movement.reason).toBe("CORRECTION");
  });

  it("A5 failure: DAMAGE above stock -> 409, nothing written", async () => {
    const product = await createProduct(prisma, { name: "A5 Overshoot", unit: "pcs", costPrice: 3, currentPrice: 5 });
    await seedStock(prisma, product.id, 2);
    const before = await prisma.stockMovement.count();

    await expectError(
      () =>
        stockService.adjustStock({
          productId: product.id,
          reason: "DAMAGE",
          quantity: 5,
        }),
      InsufficientStockError,
      /stock cannot go negative/
    );

    const fresh = await productRepository.findById(product.id);
    expect(fresh!.stockQty).toBe(2);
    expect(await prisma.stockMovement.count()).toBe(before);
  });

  it("A6 failure: CORRECTION below zero -> 409, nothing written", async () => {
    const product = await createProduct(prisma, { name: "A6 Negative", unit: "pcs", costPrice: 3, currentPrice: 5 });
    await seedStock(prisma, product.id, 3);
    const before = await prisma.stockMovement.count();

    await expectError(
      () =>
        stockService.adjustStock({
          productId: product.id,
          reason: "CORRECTION",
          quantity: -10,
        }),
      InsufficientStockError,
      /stock cannot go negative/
    );
    expect(await prisma.stockMovement.count()).toBe(before);
  });

  it("A7 failure: unknown product -> 404", async () => {
    await expectError(
      () =>
        stockService.adjustStock({
          productId: "00000000-0000-0000-0000-000000000000",
          reason: "DAMAGE",
          quantity: 1,
        }),
      NotFoundError,
      /not found/
    );
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("A8 ledger identity holds after a mix of adjustments", async () => {
    const a = await createProduct(prisma, { name: "A8 Ledger A", unit: "pcs", costPrice: 1, currentPrice: 3 });
    await seedStock(prisma, a.id, 10);
    await stockService.adjustStock({ productId: a.id, reason: "CORRECTION", quantity: 25 }); // +15
    await stockService.adjustStock({ productId: a.id, reason: "DAMAGE", quantity: 5 }); // -5

    const fresh = await productRepository.findById(a.id);
    expect(fresh!.stockQty).toBe(20);

    const movements = await prisma.stockMovement.findMany({ where: { productId: a.id } });
    const sum = movements.reduce((s, m) => s + m.qtyChange, 0);
    expect(sum).toBe(20);
    expect((await lastMovement(a.id)).reason).toBe("DAMAGE");
  });
});