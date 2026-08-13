// D1 sales integration suite — CASH / ECASH / CREDIT + tier pricing.
//
// Every scenario runs against the dedicated `erp_retail_test` database
// (refuses anything else), truncates all tables first, and runs the D3/D4/D6/
// wallet reconciliation after the body so every mutation is invariant-checked.
//
// Covered:
//   - CASH  sale  -> wallet DEPOSIT (source SALE), stock -qty, movements signed
//   - ECASH sale  -> wallet DEPOSIT, no customer side effects
//   - CREDIT sale -> customer balance += total, NO wallet entry
//   - D1 tier pricing  -> Sale.total authoritative, pricePerUnit informational
//   - multi-item sales -> one movement per product, wallet totals the sum
//   - failures: 404 unknown product, 409 insufficient stock, 400 CREDIT
//     without customerId, 404 unknown customer — all zero-row side effects.

import "dotenv/config";
import { strict as assert } from "node:assert";
import {
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from "../../lib/errors";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { SaleService } from "../../modules/sales/sale.service";
import { createDbSuite } from "../helpers/runner";
import { createProduct, createCustomer, seedStock } from "../helpers/seed";
import { createTestPrisma } from "../helpers/db";

const prisma = createTestPrisma();
const saleService = new SaleService(prisma);
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

async function walletDeposits(saleId: string): Promise<number> {
  const rows = await prisma.walletTransaction.findMany({
    where: { type: "DEPOSIT", source: "SALE", saleId },
  });
  return rows.reduce((sum, row) => sum + row.amount.toNumber(), 0);
}

async function rowCounts(): Promise<Record<string, number>> {
  return {
    sales: await prisma.sale.count(),
    saleItems: await prisma.saleItem.count(),
    movements: await prisma.stockMovement.count(),
    wallet: await prisma.walletTransaction.count(),
  };
}

// ── CASH / ECASH / CREDIT happy paths (D1) ────────────────────────────────────
await scenario("S1 CASH sale: wallet DEPOSIT, stock -qty, invariant holds", async () => {
  const product = await createProduct(prisma, { name: "S1 Rice", unit: "kg", costPrice: 10, currentPrice: 20 });
  await seedStock(prisma, product.id, 10);

  const sale = await saleService.createSale({
    paymentType: "CASH",
    items: [{ productId: product.id, quantity: 2 }],
  });

  assert.equal(sale.total, 40, "Sale.total is authoritative (D1)");
  assert.equal(sale.items.length, 1);
  assert.equal(sale.items[0].pricePerUnit, 20, "effective unit price (D1)");
  assert.equal(sale.customerId, null, "no customer attached to an anonymous CASH sale");

  const fresh = await productRepository.findById(product.id);
  assert.equal(fresh!.stockQty, 8, "stock decremented by the sold quantity");

  const deposits = await prisma.walletTransaction.findMany({
    where: { source: "SALE", saleId: sale.id },
  });
  assert.equal(deposits.length, 1, "exactly one wallet DEPOSIT for the sale");
  assert.equal(deposits[0].type, "DEPOSIT");
  assert.equal(deposits[0].amount.toNumber(), 40);
});

await scenario("S2 ECASH sale: wallet DEPOSIT, no customer row", async () => {
  const product = await createProduct(prisma, { name: "S2 Coffee", unit: "pcs", costPrice: 5, currentPrice: 10 });
  await seedStock(prisma, product.id, 5);

  const sale = await saleService.createSale({
    paymentType: "ECASH",
    items: [{ productId: product.id, quantity: 1 }],
  });

  assert.equal(sale.total, 10);
  assert.equal(await walletDeposits(sale.id), 10);
  assert.equal(await prisma.customer.count(), 0, "ECASH never touches customers");
});

await scenario("S3 CREDIT sale: customer balance += total, NO wallet entry", async () => {
  const product = await createProduct(prisma, { name: "S3 Tea", unit: "pcs", costPrice: 8, currentPrice: 15 });
  const customerId = await createCustomer(prisma, "S3 Credit Customer");
  await seedStock(prisma, product.id, 5);

  const sale = await saleService.createSale({
    paymentType: "CREDIT",
    customerId,
    items: [{ productId: product.id, quantity: 2 }],
  });

  assert.equal(sale.total, 30);
  assert.equal(sale.customerId, customerId);
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  assert.equal(customer!.balanceOwed.toNumber(), 30, "CREDIT sale raises balanceOwed (D1/D4)");
  assert.equal(await prisma.walletTransaction.count(), 0, "CREDIT creates no wallet row");
});

// ── D1 tier pricing ───────────────────────────────────────────────────────────
await scenario("S4 D1 tier pricing: total authoritative, pricePerUnit informational", async () => {
  const product = await createProduct(prisma, {
    name: "S4 Bundle Oil",
    unit: "liter",
    costPrice: 90,
    currentPrice: 30,
    priceTiers: [{ minQty: 3, price: 80 }],
  });
  await seedStock(prisma, product.id, 10);

  const sale = await saleService.createSale({
    paymentType: "CASH",
    items: [{ productId: product.id, quantity: 7 }],
  });

  // 7 liters: two 3-liter bundles (80+80) + one unit (30) = 190.
  assert.equal(sale.total, 190, "Sale.total drives money/stock (D1)");
  assert.equal(sale.items[0].pricePerUnit, Math.round((190 / 7) * 100) / 100, "effective unit price = total/qty rounded to paisa (D1)");
  assert.equal(await walletDeposits(sale.id), 190, "wallet records Sale.total, not qty x pricePerUnit");

  const fresh = await productRepository.findById(product.id);
  assert.equal(fresh!.stockQty, 3);
});

await scenario("S5 multi-item sale: one movement each, wallet sums all lines", async () => {
  const a = await createProduct(prisma, { name: "S5 A", unit: "kg", costPrice: 10, currentPrice: 20 });
  const b = await createProduct(prisma, { name: "S5 B", unit: "kg", costPrice: 5, currentPrice: 12 });
  await seedStock(prisma, a.id, 10);
  await seedStock(prisma, b.id, 10);

  const sale = await saleService.createSale({
    paymentType: "CASH",
    items: [
      { productId: a.id, quantity: 3 }, // 60
      { productId: b.id, quantity: 2 }, // 24
    ],
  });

  assert.equal(sale.total, 84);
  assert.equal(sale.items.length, 2);
  assert.equal(await walletDeposits(sale.id), 84);

  const stockA = await productRepository.findById(a.id);
  const stockB = await productRepository.findById(b.id);
  assert.equal(stockA!.stockQty, 7);
  assert.equal(stockB!.stockQty, 8);

  const movements = await prisma.stockMovement.findMany({ where: { reason: "SALE" } });
  assert.equal(movements.length, 2, "one SALE movement per product");
  assert.deepEqual(
    movements.map((m) => m.qtyChange).sort((a, b) => a - b),
    [-3, -2]
  );
});

// ── Failure paths ─────────────────────────────────────────────────────────────
await scenario("S6 failure: unknown product -> 404, zero rows", async () => {
  await expectError(
    () =>
      saleService.createSale({
        paymentType: "CASH",
        items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
      }),
    NotFoundError,
    /not found/
  );
  assert.deepEqual(await rowCounts(), { sales: 0, saleItems: 0, movements: 0, wallet: 0 });
});

await scenario("S7 failure: insufficient stock -> 409, nothing partial", async () => {
  const product = await createProduct(prisma, { name: "S7 Scarce", unit: "pcs", costPrice: 4, currentPrice: 8 });
  await seedStock(prisma, product.id, 2);
  const before = await rowCounts();

  await expectError(
    () =>
      saleService.createSale({
        paymentType: "CASH",
        items: [{ productId: product.id, quantity: 5 }],
      }),
    InsufficientStockError,
    /stock/
  );

  const fresh = await productRepository.findById(product.id);
  assert.equal(fresh!.stockQty, 2, "stock untouched after a failed sale");
  assert.deepEqual(await rowCounts(), before, "failed sale adds zero rows");
});

await scenario("S8 failure: CREDIT without customerId -> 400", async () => {
  const product = await createProduct(prisma, { name: "S8 NoCust", unit: "pcs", costPrice: 1, currentPrice: 2 });
  await seedStock(prisma, product.id, 3);
  const before = await rowCounts();

  await expectError(
    () =>
      saleService.createSale({
        paymentType: "CREDIT",
        items: [{ productId: product.id, quantity: 1 }],
      }),
    ValidationError,
    /customerId is required/
  );
  assert.deepEqual(await rowCounts(), before, "failed sale adds zero rows");
});

await scenario("S9 failure: CREDIT with unknown customer -> 404", async () => {
  const product = await createProduct(prisma, { name: "S9 NoCust2", unit: "pcs", costPrice: 1, currentPrice: 2 });
  await seedStock(prisma, product.id, 3);
  const before = await rowCounts();

  await expectError(
    () =>
      saleService.createSale({
        paymentType: "CREDIT",
        customerId: "00000000-0000-0000-0000-000000000000",
        items: [{ productId: product.id, quantity: 1 }],
      }),
    NotFoundError,
    /Customer/
  );
  assert.deepEqual(await rowCounts(), before, "failed sale adds zero rows");
});

await scenario("S10 invariant: CASH sale for a credit customer leaves balanceOwed untouched", async () => {
  const product = await createProduct(prisma, { name: "S10 Mix", unit: "pcs", costPrice: 2, currentPrice: 5 });
  const customerId = await createCustomer(prisma, "S10 Cash-on-credit-acct");
  await seedStock(prisma, product.id, 6);

  // Establish a legitimate credit balance via a CREDIT sale (D4).
  await saleService.createSale({
    paymentType: "CREDIT",
    customerId,
    items: [{ productId: product.id, quantity: 2 }], // balance += 10
  });

  const cashSale = await saleService.createSale({
    paymentType: "CASH",
    customerId,
    items: [{ productId: product.id, quantity: 1 }], // should NOT touch the balance
  });

  assert.equal(cashSale.total, 5);
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  assert.equal(customer!.balanceOwed.toNumber(), 10, "CASH sale never mutates customer balance");
  
  const creditSales = await prisma.sale.findMany({ where: { paymentType: "CREDIT", customerId } });
  const creditTotal = creditSales.reduce((sum, s) => sum + s.total.toNumber(), 0);
  assert.equal(creditTotal, 10, "D4: balance == Σ credit sales");
});

const code = finish();
await prisma.$disconnect();
process.exit(code);