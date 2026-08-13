// D6 stock-adjustment integration suite — DAMAGE / CORRECTION semantics.
//
//   DAMAGE      : quantity = amount ruined  -> movement -quantity
//   CORRECTION  : quantity = desired level   -> movement target - current
//   A result below zero is rejected with 409 before any write.
//   DAMAGE/CORRECTION never touch wallet, customer, or supplier records.

import "dotenv/config";
import { strict as assert } from "node:assert";
import {
  InsufficientStockError,
  NotFoundError,
} from "../../lib/errors";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { StockService } from "../../modules/stock/stock.service";
import { createDbSuite } from "../helpers/runner";
import { createProduct, seedStock } from "../helpers/seed";
import { createTestPrisma } from "../helpers/db";

const prisma = createTestPrisma();
const stockService = new StockService(prisma);
const productRepository = new PrismaProductRepository(prisma);
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

async function lastMovement(productId: string) {
  const rows = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { date: "asc" },
  });
  return rows[rows.length - 1];
}

await scenario("A1 DAMAGE: stock -qty, signed movement, no side effects", async () => {
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

  assert.equal(result.product.stockQty, 7, "D6: DAMAGE 3 of 10 -> 7");
  assert.equal(result.movement.qtyChange, -3, "D6: signed movement");

  assert.deepEqual(
    { customers: await prisma.customer.count(), suppliers: await prisma.supplier.count(), wallet: await prisma.walletTransaction.count() },
    before,
    "DAMAGE has no wallet/customer/supplier side effects"
  );
});

await scenario("A2 CORRECTION up: movement target - current", async () => {
  const product = await createProduct(prisma, { name: "A2 Oil", unit: "liter", costPrice: 90, currentPrice: 100 });
  await seedStock(prisma, product.id, 10);

  const result = await stockService.adjustStock({
    productId: product.id,
    reason: "CORRECTION",
    quantity: 25,
  });
  assert.equal(result.product.stockQty, 25, "target is the desired final level");
  assert.equal(result.movement.qtyChange, 15, "25 - 10 = +15");
});

await scenario("A3 CORRECTION down: movement target - current (negative)", async () => {
  const product = await createProduct(prisma, { name: "A3 Biscuits", unit: "pcs", costPrice: 5, currentPrice: 8 });
  await seedStock(prisma, product.id, 30);

  const result = await stockService.adjustStock({
    productId: product.id,
    reason: "CORRECTION",
    quantity: 4,
  });
  assert.equal(result.product.stockQty, 4);
  assert.equal(result.movement.qtyChange, -26, "4 - 30 = -26");
});

await scenario("A4 CORRECTION to the same level creates a zero movement", async () => {
  const product = await createProduct(prisma, { name: "A4 Static", unit: "pcs", costPrice: 2, currentPrice: 4 });
  await seedStock(prisma, product.id, 7);

  const result = await stockService.adjustStock({
    productId: product.id,
    reason: "CORRECTION",
    quantity: 7,
  });
  assert.equal(result.product.stockQty, 7);
  assert.equal(result.movement.qtyChange, 0);
  assert.equal(result.movement.reason, "CORRECTION");
});

await scenario("A5 failure: DAMAGE above stock -> 409, nothing written", async () => {
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
  assert.equal(fresh!.stockQty, 2, "stock unchanged");
  assert.equal(await prisma.stockMovement.count(), before, "no movement recorded");
});

await scenario("A6 failure: CORRECTION below zero -> 409, nothing written", async () => {
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
  assert.equal(await prisma.stockMovement.count(), before, "no movement recorded");
});

await scenario("A7 failure: unknown product -> 404", async () => {
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
  assert.equal(await prisma.stockMovement.count(), 0);
});

await scenario("A8 ledger identity holds after a mix of adjustments", async () => {
  const a = await createProduct(prisma, { name: "A8 Ledger A", unit: "pcs", costPrice: 1, currentPrice: 3 });
  await seedStock(prisma, a.id, 10);
  await stockService.adjustStock({ productId: a.id, reason: "CORRECTION", quantity: 25 }); // +15
  await stockService.adjustStock({ productId: a.id, reason: "DAMAGE", quantity: 5 }); // -5

  const fresh = await productRepository.findById(a.id);
  assert.equal(fresh!.stockQty, 20);

  const movements = await prisma.stockMovement.findMany({ where: { productId: a.id } });
  const sum = movements.reduce((s, m) => s + m.qtyChange, 0);
  assert.equal(sum, 20, "D6: stockQty == Σ movements incl. CORRECTION + DAMAGE");
  assert.equal(await lastMovement(a.id).then((m) => m.reason), "DAMAGE");
});

const code = finish();
await prisma.$disconnect();
process.exit(code);