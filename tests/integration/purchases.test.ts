// D2/D3 purchasing integration suite — CASH / CREDIT + cost repricing (Vitest).
//
//   - CASH purchase  -> wallet WITHDRAWAL (source SUPPLIER_PAYMENT), stock +qty,
//                       supplier balance UNCHANGED
//   - CREDIT purchase -> supplier balance += total, NO wallet entry, stock +qty
//   - D2: Product.costPrice becomes the latest costPerUnit; earlier
//         PurchaseItem.costPerUnit rows are immutable history
//   - failures: 404 unknown supplier / unknown product — zero partial rows,
//               no wallet movement, no stock change, no balance change

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../../lib/errors";
import { paisaFromDecimal } from "../../lib/money";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, createSupplier } from "../helpers/seed";

const prisma = createTestPrisma();
const purchaseService = new PurchaseService(prisma);
const productRepository = new PrismaProductRepository(prisma);
const supplierRepository = new PrismaSupplierRepository(prisma);

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

async function state(): Promise<{
  purchases: number;
  purchaseItems: number;
  movements: number;
  wallet: number;
}> {
  return {
    purchases: await prisma.purchase.count(),
    purchaseItems: await prisma.purchaseItem.count(),
    movements: await prisma.stockMovement.count(),
    wallet: await prisma.walletTransaction.count(),
  };
}

describe("purchases (D2/D3)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("P1 CASH purchase: wallet WITHDRAWAL, stock +qty, supplier balance unchanged", async () => {
    const product = await createProduct(prisma, { name: "P1 Flour", unit: "kg", costPrice: 1000, currentPrice: 2000 });
    const supplierId = await createSupplier(prisma, "P1 Wholesale");

    const purchase = await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 10, costPerUnit: 2000 }],
    });

    expect(purchase.total).toBe(20000);
    const fresh = await productRepository.findById(product.id);
    expect(fresh!.stockQty).toBe(10);
    expect(fresh!.costPrice).toBe(2000);

    const supplier = await supplierRepository.findById(supplierId);
    expect(supplier!.balanceOwed).toBe(0);

    const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    expect(rows.length).toBe(1);
    expect(paisaFromDecimal(rows[0].amount)).toBe(20000);

    const movement = await prisma.stockMovement.findMany({ where: { reason: "PURCHASE", productId: product.id } });
    expect(movement.length).toBe(1);
    expect(movement[0].qtyChange).toBe(10);
  });

  it("P2 CREDIT purchase: supplier balance += total, NO wallet entry", async () => {
    const product = await createProduct(prisma, { name: "P2 Sugar", unit: "kg", costPrice: 3000, currentPrice: 4000 });
    const supplierId = await createSupplier(prisma, "P2 Credit Wholesale");

    const purchase = await purchaseService.createPurchase({
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: 5, costPerUnit: 3000 }],
    });

    expect(purchase.total).toBe(15000);
    const supplier = await supplierRepository.findById(supplierId);
    expect(supplier!.balanceOwed).toBe(15000);

    expect(await prisma.walletTransaction.count()).toBe(0);
    const fresh = await productRepository.findById(product.id);
    expect(fresh!.stockQty).toBe(5);
  });

  it("P3 D2: costPrice tracks the latest purchase; history frozen", async () => {
    const product = await createProduct(prisma, { name: "P3 Oil", unit: "liter", costPrice: 1800, currentPrice: 2500 });
    const supplierId = await createSupplier(prisma, "P3 Two-dip Wholesale");

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 100, costPerUnit: 2000 }],
    });
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 50, costPerUnit: 2200 }],
    });

    const fresh = await productRepository.findById(product.id);
    expect(fresh!.costPrice).toBe(2200);
    expect(fresh!.stockQty).toBe(150);

    const items = await prisma.purchaseItem.findMany({
      where: { productId: product.id },
      orderBy: { costPerUnit: "asc" },
    });
    expect(items.map((i) => paisaFromDecimal(i.costPerUnit))).toEqual([2000, 2200]);
  });

  it("P4 failure: unknown supplier -> 404, zero rows", async () => {
    const product = await createProduct(prisma, { name: "P4 Ghost Supplier", unit: "pcs", costPrice: 1, currentPrice: 2 });
    const before = await state();

    await expectError(
      () =>
        purchaseService.createPurchase({
          supplierId: "00000000-0000-0000-0000-000000000000",
          paymentType: "CASH",
          items: [{ productId: product.id, quantity: 1, costPerUnit: 5 }],
        }),
      NotFoundError,
      /Supplier/
    );
    expect(await state()).toEqual(before);
  });

  it("P5 failure: unknown product on line 2 -> 404, full rollback", async () => {
    const product = await createProduct(prisma, { name: "P5 Real", unit: "pcs", costPrice: 1, currentPrice: 3 });
    const supplierId = await createSupplier(prisma, "P5 Mixed Order");
    const before = await state();
    const started = await supplierRepository.findById(supplierId);

    await expectError(
      () =>
        purchaseService.createPurchase({
          supplierId,
          paymentType: "CASH",
          items: [
            { productId: product.id, quantity: 2, costPerUnit: 3 }, // valid line
            { productId: "00000000-0000-0000-0000-000000000000", quantity: 1, costPerUnit: 3 }, // ghost line
          ],
        }),
      NotFoundError
    );
    expect(await state()).toEqual(before);
    const after = await supplierRepository.findById(supplierId);
    expect(after).toEqual(started);
  });

  it("P6 CASH purchase: stock and movement ledger stay consistent", async () => {
    const a = await createProduct(prisma, { name: "P6 A", unit: "pcs", costPrice: 100, currentPrice: 200 });
    const supplierId = await createSupplier(prisma, "P6 Bulk");

    const purchase = await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [
        { productId: a.id, quantity: 4, costPerUnit: 100 },
      ],
    });

    const movements = await prisma.stockMovement.findMany({
      where: { productId: a.id, reason: "PURCHASE" },
    });
    const sumMovement = movements.reduce((s, m) => s + m.qtyChange, 0);
    const fresh = await productRepository.findById(a.id);
    expect(fresh!.stockQty).toBe(4);
    expect(sumMovement).toBe(4);
    expect(purchase.total).toBe(400);
  });
});