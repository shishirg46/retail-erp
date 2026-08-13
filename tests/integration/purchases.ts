// D2/D3 purchasing integration suite — CASH / CREDIT + cost repricing.
//
//   - CASH purchase  -> wallet WITHDRAWAL (source SUPPLIER_PAYMENT), stock +qty,
//                       supplier balance UNCHANGED
//   - CREDIT purchase -> supplier balance += total, NO wallet entry, stock +qty
//   - D2: Product.costPrice becomes the latest costPerUnit; earlier
//         PurchaseItem.costPerUnit rows are immutable history
//   - failures: 404 unknown supplier / unknown product — zero partial rows,
//               no wallet movement, no stock change, no balance change

import "dotenv/config";
import { strict as assert } from "node:assert";
import { NotFoundError } from "../../lib/errors";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { createDbSuite } from "../helpers/runner";
import { createProduct, createSupplier } from "../helpers/seed";
import { createTestPrisma } from "../helpers/db";

const prisma = createTestPrisma();
const purchaseService = new PurchaseService(prisma);
const productRepository = new PrismaProductRepository(prisma);
const supplierRepository = new PrismaSupplierRepository(prisma);
const { scenario, finish } = createDbSuite(prisma);

async function expectError(
  fn: () => Promise<unknown>,
  ctor: new (...args: never[]) => Error,
  pattern?: RegExp
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (error) {
    threw = true;
    assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${(error as Error).message}`);
    if (pattern) assert.match((error as Error).message, pattern);
  }
  assert.ok(threw, `expected ${ctor.name} to be thrown`);
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

await scenario("P1 CASH purchase: wallet WITHDRAWAL, stock +qty, supplier balance unchanged", async () => {
  const product = await createProduct(prisma, { name: "P1 Flour", unit: "kg", costPrice: 10, currentPrice: 20 });
  const supplierId = await createSupplier(prisma, "P1 Wholesale");

  const purchase = await purchaseService.createPurchase({
    supplierId,
    paymentType: "CASH",
    items: [{ productId: product.id, quantity: 10, costPerUnit: 20 }],
  });

  assert.equal(purchase.total, 200);
  const fresh = await productRepository.findById(product.id);
  assert.equal(fresh!.stockQty, 10, "stock increased by the purchased quantity");
  assert.equal(fresh!.costPrice, 20, "D2: costPrice becomes the latest cost");

  const supplier = await supplierRepository.findById(supplierId);
  assert.equal(supplier!.balanceOwed, 0, "D3: CASH purchase must not inflate supplier balance");

  const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
  assert.equal(rows.length, 1, "exactly one wallet WITHDRAWAL");
  assert.equal(rows[0].amount.toNumber(), 200, "D3: wallet decrease == purchase total");

  const movement = await prisma.stockMovement.findMany({ where: { reason: "PURCHASE", productId: product.id } });
  assert.equal(movement.length, 1);
  assert.equal(movement[0].qtyChange, 10);
});

await scenario("P2 CREDIT purchase: supplier balance += total, NO wallet entry", async () => {
  const product = await createProduct(prisma, { name: "P2 Sugar", unit: "kg", costPrice: 30, currentPrice: 40 });
  const supplierId = await createSupplier(prisma, "P2 Credit Wholesale");

  const purchase = await purchaseService.createPurchase({
    supplierId,
    paymentType: "CREDIT",
    items: [{ productId: product.id, quantity: 5, costPerUnit: 30 }],
  });

  assert.equal(purchase.total, 150);
  const supplier = await supplierRepository.findById(supplierId);
  assert.equal(supplier!.balanceOwed, 150, "D3: CREDIT purchase raises what the shop owes");

  assert.equal(await prisma.walletTransaction.count(), 0, "D3: CREDIT creates no wallet row");
  const fresh = await productRepository.findById(product.id);
  assert.equal(fresh!.stockQty, 5);
});

await scenario("P3 D2: costPrice tracks the latest purchase; history frozen", async () => {
  const product = await createProduct(prisma, { name: "P3 Oil", unit: "liter", costPrice: 18, currentPrice: 25 });
  const supplierId = await createSupplier(prisma, "P3 Two-dip Wholesale");

  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CASH",
    items: [{ productId: product.id, quantity: 100, costPerUnit: 20 }],
  });
  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CASH",
    items: [{ productId: product.id, quantity: 50, costPerUnit: 22 }],
  });

  const fresh = await productRepository.findById(product.id);
  assert.equal(fresh!.costPrice, 22, "D2 example: 18 -> 20 -> 22");
  assert.equal(fresh!.stockQty, 150);

  const items = await prisma.purchaseItem.findMany({
    where: { productId: product.id },
    orderBy: { costPerUnit: "asc" },
  });
  assert.deepEqual(items.map((i) => i.costPerUnit.toNumber()), [20, 22], "historical costs untouched (D2)");
});

await scenario("P4 failure: unknown supplier -> 404, zero rows", async () => {
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
  assert.deepEqual(await state(), before, "no partial writes");
});

await scenario("P5 failure: unknown product on line 2 -> 404, full rollback", async () => {
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
          { productId: "00000000-0000-0000-0000-000000000000", quantity: 1, costPerUnit: 3 }, // ghosts
        ],
      }),
    NotFoundError
  );
  assert.deepEqual(await state(), before, "nothing persisted — whole purchase rolled back");
  const after = await supplierRepository.findById(supplierId);
  assert.deepEqual(after, started, "supplier balance unchanged");
});

await scenario("P6 CASH purchase: stock and movement ledger stay consistent", async () => {
  const a = await createProduct(prisma, { name: "P6 A", unit: "pcs", costPrice: 1, currentPrice: 2 });
  const supplierId = await createSupplier(prisma, "P6 Bulk");

  const purchase = await purchaseService.createPurchase({
    supplierId,
    paymentType: "CASH",
    items: [
      { productId: a.id, quantity: 4, costPerUnit: 1 },
    ],
  });

  // Reconcile (auto) proves stockQty == Σ movements; double-check the ledger.
  const movements = await prisma.stockMovement.findMany({
    where: { productId: a.id, reason: "PURCHASE" },
  });
  const sumMovement = movements.reduce((s, m) => s + m.qtyChange, 0);
  const fresh = await productRepository.findById(a.id);
  assert.equal(fresh!.stockQty, 4);
  assert.equal(sumMovement, 4, "D6: stockQty == Σ movements");
  assert.equal(purchase.total, 4);
});

const code = finish();
await prisma.$disconnect();
process.exit(code);