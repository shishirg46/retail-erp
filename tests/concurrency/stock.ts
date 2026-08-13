// F-02 concurrency regression suite.
//
// Proves that concurrent stock consumption (SALE / DAMAGE) cannot oversell or
// drive stock below zero, and that the D6 reconciliation invariant
// (Product.stockQty == Σ StockMovement.qtyChange) always holds afterwards.
//
// Runs ONLY against the dedicated test database (TEST_DATABASE_URL). It refuses
// to start if the variable is missing or points at any database other than
// `erp_retail_test`, so the development database can never be used here.

import "dotenv/config";
import { strict as assert } from "node:assert";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { InsufficientStockError } from "../../lib/errors";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PrismaStockRepository } from "../../modules/stock/stock.repository";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { SaleService } from "../../modules/sales/sale.service";
import { StockService } from "../../modules/stock/stock.service";
import { PurchaseService } from "../../modules/purchases/purchase.service";

const rawUrl = process.env.TEST_DATABASE_URL;

if (!rawUrl) {
  console.error(
    "TEST_DATABASE_URL is not set — refusing to run. Set it to the dedicated erp_retail_test database."
  );
  process.exit(1);
}

const testUrl = rawUrl.replace(/^"|"$/g, "");
const parsed = new URL(testUrl);
const dbName = parsed.pathname.replace(/^\//, "").split("?")[0];

if (dbName !== "erp_retail_test") {
  console.error(
    `TEST_DATABASE_URL must point at erp_retail_test (got '${dbName}') — refusing to run against any other database.`
  );
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testUrl }),
});

const productRepository = new PrismaProductRepository(prisma);
const stockRepository = new PrismaStockRepository(prisma);
const saleService = new SaleService(prisma);
const stockService = new StockService(prisma);
const purchaseService = new PurchaseService(prisma);

// Shared between scenarios — each scenario resets the tables first.
let passed = 0;
let failed = 0;

async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      wallet_transactions,
      credit_payments,
      sale_items,
      sales,
      stock_movements,
      purchase_items,
      purchases,
      price_tiers,
      products,
      supplier_payments,
      suppliers,
      customers
    CASCADE
  `);
}

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

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  await resetDatabase();
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

// ── Scenario 1: two parallel SALE on the last unit ──────────────────────────
async function s1(): Promise<void> {
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
  assert.equal(ok.length, 1, "exactly one sale succeeds");
  assert.equal(err.length, 1, "exactly one sale fails");
  assert.ok(isInsufficient(err[0].reason), "failure is InsufficientStockError (409)");

  const product = await productRepository.findById(id);
  assert.equal(product!.stockQty, 0, "stock cannot go negative");
  assert.equal(await movementSum(id), 0, "stockQty == Σ movements");

  const sales = await prisma.sale.count();
  const saleItems = await prisma.saleItem.count();
  const wallets = await prisma.walletTransaction.count();
  assert.equal(sales, 1, "only one sale row survives (loser rolled back)");
  assert.equal(saleItems, 1, "only one sale item survives");
  assert.equal(wallets, 1, "only the winning CASH sale deposits to the wallet");
}

// ── Scenario 2: ten parallel SALE on stock of 5 ─────────────────────────────
async function s2(): Promise<void> {
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
  assert.equal(ok.length, 5, "exactly five sales succeed");
  assert.equal(err.length, 5, "exactly five sales fail");
  assert.ok(err.every((r) => isInsufficient(r.reason)), "all failures are 409");

  const product = await productRepository.findById(id);
  assert.equal(product!.stockQty, 0, "stock cannot go negative");
  assert.equal(await movementSum(id), 0, "stockQty == Σ movements");

  assert.equal(await prisma.sale.count(), 5, "five sale rows survive");
  assert.equal(await prisma.walletTransaction.count(), 5, "five wallet deposits");
}

// ── Scenario 3: two parallel DAMAGE on stock of 2 ───────────────────────────
async function s3(): Promise<void> {
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
  assert.equal(ok.length, 1, "exactly one DAMAGE succeeds");
  assert.equal(err.length, 1, "exactly one DAMAGE fails");
  assert.ok(isInsufficient(err[0].reason), "failure is 409");

  const product = await productRepository.findById(id);
  assert.equal(product!.stockQty, 0, "stock cannot go negative");
  assert.equal(await movementSum(id), 0, "stockQty == Σ movements");

  // DAMAGE must have no wallet / customer / supplier side effects.
  assert.equal(await prisma.customer.count(), before.customers, "no customer rows");
  assert.equal(await prisma.supplier.count(), before.suppliers, "no supplier rows");
  assert.equal(await prisma.walletTransaction.count(), before.wallets, "no wallet rows");
}

// ── Scenario 4: parallel SALE + DAMAGE on the last unit ─────────────────────
async function s4(): Promise<void> {
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
  assert.equal(ok.length, 1, "exactly one operation succeeds");
  assert.equal(err.length, 1, "exactly one operation fails");
  assert.ok(isInsufficient(err[0].reason), "failure is 409");

  const product = await productRepository.findById(id);
  assert.equal(product!.stockQty, 0, "stock cannot go negative");
  assert.equal(await movementSum(id), 0, "stockQty == Σ movements");

  const reasons = await prisma.stockMovement.findMany({
    where: { productId: id, reason: { in: ["SALE", "DAMAGE"] } },
  });
  assert.equal(reasons.length, 1, "exactly one SALE or DAMAGE movement");
}

// ── Scenario 5: sell-out then purchase (replenishment sanity) ───────────────
async function s5(): Promise<void> {
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
  assert.equal(product!.stockQty, 5, "stock replenished to 5");
  assert.equal(product!.costPrice, 12, "costPrice re-priced to latest cost (D2)");
  assert.equal(await movementSum(id), 5, "stockQty == Σ movements");
}

async function main(): Promise<void> {
  await scenario("S1: two parallel sales on last unit", s1);
  await scenario("S2: ten parallel sales on stock of 5", s2);
  await scenario("S3: two parallel DAMAGE on stock of 2", s3);
  await scenario("S4: parallel SALE + DAMAGE on last unit", s4);
  await scenario("S5: sell-out then purchase", s5);

  await resetDatabase();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
