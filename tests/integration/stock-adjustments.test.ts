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
import { quantityFromDecimal } from "../../lib/quantity";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { StockService } from "../../modules/stock/stock.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, seedStock, units } from "../helpers/seed";

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
      quantity: units(3),
      note: "burst bag",
    });

    expect(result.product.stockQty).toBe(units(7));
    expect(result.movement.qtyChange).toBe(units(-3));

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
      quantity: units(25),
    });
    expect(result.product.stockQty).toBe(units(25));
    expect(result.movement.qtyChange).toBe(units(15));
  });

  it("A3 CORRECTION down: movement target - current (negative)", async () => {
    const product = await createProduct(prisma, { name: "A3 Biscuits", unit: "pcs", costPrice: 5, currentPrice: 8 });
    await seedStock(prisma, product.id, 30);

    const result = await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: units(4),
    });
    expect(result.product.stockQty).toBe(units(4));
    expect(result.movement.qtyChange).toBe(units(-26));
  });

  it("A4 CORRECTION to the same level creates a zero movement", async () => {
    const product = await createProduct(prisma, { name: "A4 Static", unit: "pcs", costPrice: 2, currentPrice: 4 });
    await seedStock(prisma, product.id, 7);

    const result = await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: units(7),
    });
    expect(result.product.stockQty).toBe(units(7));
    expect(result.movement.qtyChange).toBe(0);
    expect(result.movement.reason).toBe("CORRECTION");
  });

  it("A4b fractional DAMAGE and CORRECTION remain exact for measurable units", async () => {
    const product = await createProduct(prisma, { name: "A4b Fractional", unit: "kg", costPrice: 90, currentPrice: 110 });
    await seedStock(prisma, product.id, 4.5);

    const damage = await stockService.adjustStock({
      productId: product.id,
      reason: "DAMAGE",
      quantity: units(0.25),
    });
    expect(damage.product.stockQty).toBe(units(4.25));
    expect(damage.movement.qtyChange).toBe(units(-0.25));

    const correction = await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: units(5.5),
    });
    expect(correction.product.stockQty).toBe(units(5.5));
    expect(correction.movement.qtyChange).toBe(units(1.25));
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
          quantity: units(5),
        }),
      InsufficientStockError,
      /stock cannot go negative/
    );

    const fresh = await productRepository.findById(product.id);
    expect(fresh!.stockQty).toBe(units(2));
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
          quantity: units(-10),
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
          quantity: units(1),
        }),
      NotFoundError,
      /not found/
    );
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("A8 ledger identity holds after a mix of adjustments", async () => {
    const a = await createProduct(prisma, { name: "A8 Ledger A", unit: "pcs", costPrice: 1, currentPrice: 3 });
    await seedStock(prisma, a.id, 10);
    await stockService.adjustStock({ productId: a.id, reason: "CORRECTION", quantity: units(25) }); // +15
    await stockService.adjustStock({ productId: a.id, reason: "DAMAGE", quantity: units(5) }); // -5

    const fresh = await productRepository.findById(a.id);
    expect(fresh!.stockQty).toBe(units(20));

    const movements = await prisma.stockMovement.findMany({ where: { productId: a.id } });
    const sum = movements.reduce((s, m) => s + quantityFromDecimal(m.qtyChange), 0);
    expect(sum).toBe(units(20));
    expect((await lastMovement(a.id)).reason).toBe("DAMAGE");
  });
});