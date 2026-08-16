// D1 sales integration suite — CASH / ECASH / CREDIT + tier pricing (Vitest).
//
// Every test runs against the dedicated `erp_retail_test` database
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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from "../../lib/errors";
import { paisaFromDecimal } from "../../lib/money";
import { quantityFromDecimal } from "../../lib/quantity";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { SaleService } from "../../modules/sales/sale.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, createCustomer, seedStock, units } from "../helpers/seed";

const prisma = createTestPrisma();
const saleService = new SaleService(prisma);
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

// Wallet rows store rupee Decimals; sum as whole paisa so assertions compare
// like-for-like with the paisa domain values (D11).
async function walletDeposits(saleId: string): Promise<number> {
  const rows = await prisma.walletTransaction.findMany({
    where: { type: "DEPOSIT", source: "SALE", saleId },
  });
  return rows.reduce((sum, row) => sum + paisaFromDecimal(row.amount), 0);
}

async function rowCounts(): Promise<Record<string, number>> {
  return {
    sales: await prisma.sale.count(),
    saleItems: await prisma.saleItem.count(),
    movements: await prisma.stockMovement.count(),
    wallet: await prisma.walletTransaction.count(),
  };
}

describe("sales (D1)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  // ── CASH / ECASH / CREDIT happy paths (D1) ────────────────────────────────
  it("S1 CASH sale: wallet DEPOSIT, stock -qty, invariant holds", async () => {
    const product = await createProduct(prisma, { name: "S1 Rice", unit: "kg", costPrice: 1000, currentPrice: 2000 });
    await seedStock(prisma, product.id, 10);

    const sale = await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(2) }],
    });

    expect(sale.total).toBe(4000);
    expect(sale.items.length).toBe(1);
    expect(sale.items[0].pricePerUnit).toBe(2000);
    expect(sale.customerId).toBeNull();

    const fresh = await productRepository.findById(product.id);
    expect(fresh!.stockQty).toBe(units(8));

    const deposits = await prisma.walletTransaction.findMany({
      where: { source: "SALE", saleId: sale.id },
    });
    expect(deposits.length).toBe(1);
    expect(deposits[0].type).toBe("DEPOSIT");
    expect(paisaFromDecimal(deposits[0].amount)).toBe(4000);
  });

  it("S2 ECASH sale: wallet DEPOSIT, no customer row", async () => {
    const product = await createProduct(prisma, { name: "S2 Coffee", unit: "pcs", costPrice: 500, currentPrice: 1000 });
    await seedStock(prisma, product.id, 5);

    const sale = await saleService.createSale({
      paymentType: "ECASH",
      items: [{ productId: product.id, quantity: units(1) }],
    });

    expect(sale.total).toBe(1000);
    expect(await walletDeposits(sale.id)).toBe(1000);
    expect(await prisma.customer.count()).toBe(0);
  });

  it("S3 CREDIT sale: customer balance += total, NO wallet entry", async () => {
    const product = await createProduct(prisma, { name: "S3 Tea", unit: "pcs", costPrice: 800, currentPrice: 1500 });
    const customerId = await createCustomer(prisma, "S3 Credit Customer");
    await seedStock(prisma, product.id, 5);

    const sale = await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: units(2) }],
    });

    expect(sale.total).toBe(3000);
    expect(sale.customerId).toBe(customerId);
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(paisaFromDecimal(customer!.balanceOwed)).toBe(3000);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  // ── D1 tier pricing ────────────────────────────────────────────────────────
  it("S4 D1 tier pricing: total authoritative, pricePerUnit informational", async () => {
    const product = await createProduct(prisma, {
      name: "S4 Bundle Oil",
      unit: "liter",
      costPrice: 9000,
      currentPrice: 3000,
      priceTiers: [{ minQty: units(3), price: 8000 }],
    });
    await seedStock(prisma, product.id, 10);

    const sale = await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(7) }],
    });

    // 7 liters: two 3-liter bundles (8000+8000) + one unit (3000) = 19000.
    expect(sale.total).toBe(19000);
    expect(sale.items[0].pricePerUnit).toBe(Math.round(19000 / 7));
    expect(await walletDeposits(sale.id)).toBe(19000);

    const fresh = await productRepository.findById(product.id);
    expect(fresh!.stockQty).toBe(units(3));
  });

  it("S5 multi-item sale: one movement each, wallet sums all lines", async () => {
    const a = await createProduct(prisma, { name: "S5 A", unit: "kg", costPrice: 1000, currentPrice: 2000 });
    const b = await createProduct(prisma, { name: "S5 B", unit: "kg", costPrice: 500, currentPrice: 1200 });
    await seedStock(prisma, a.id, 10);
    await seedStock(prisma, b.id, 10);

    const sale = await saleService.createSale({
      paymentType: "CASH",
      items: [
        { productId: a.id, quantity: units(3) }, // 6000
        { productId: b.id, quantity: units(2) }, // 2400
      ],
    });

    expect(sale.total).toBe(8400);
    expect(sale.items.length).toBe(2);
    expect(await walletDeposits(sale.id)).toBe(8400);

    const stockA = await productRepository.findById(a.id);
    const stockB = await productRepository.findById(b.id);
    expect(stockA!.stockQty).toBe(units(7));
    expect(stockB!.stockQty).toBe(units(8));

    const movements = await prisma.stockMovement.findMany({ where: { reason: "SALE" } });
    expect(movements.length).toBe(2);
    expect(
      movements
        .map((m) => quantityFromDecimal(m.qtyChange))
        .sort((a, b) => a - b)
    ).toEqual([units(-3), units(-2)]);
  });

  // ── Failure paths ──────────────────────────────────────────────────────────
  it("S6 failure: unknown product -> 404, zero rows", async () => {
    await expectError(
      () =>
        saleService.createSale({
          paymentType: "CASH",
          items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: units(1) }],
        }),
      NotFoundError,
      /not found/
    );
    expect(await rowCounts()).toEqual({ sales: 0, saleItems: 0, movements: 0, wallet: 0 });
  });

  it("S7 failure: insufficient stock -> 409, nothing partial", async () => {
    const product = await createProduct(prisma, { name: "S7 Scarce", unit: "pcs", costPrice: 4, currentPrice: 8 });
    await seedStock(prisma, product.id, 2);
    const before = await rowCounts();

    await expectError(
      () =>
        saleService.createSale({
          paymentType: "CASH",
          items: [{ productId: product.id, quantity: units(5) }],
        }),
      InsufficientStockError,
      /stock/
    );

    const fresh = await productRepository.findById(product.id);
    expect(fresh!.stockQty).toBe(units(2));
    expect(await rowCounts()).toEqual(before);
  });

  it("S8 failure: CREDIT without customerId -> 400", async () => {
    const product = await createProduct(prisma, { name: "S8 NoCust", unit: "pcs", costPrice: 1, currentPrice: 2 });
    await seedStock(prisma, product.id, 3);
    const before = await rowCounts();

    await expectError(
      () =>
        saleService.createSale({
          paymentType: "CREDIT",
          items: [{ productId: product.id, quantity: units(1) }],
        }),
      ValidationError,
      /customerId is required/
    );
    expect(await rowCounts()).toEqual(before);
  });

  it("S9 failure: CREDIT with unknown customer -> 404", async () => {
    const product = await createProduct(prisma, { name: "S9 NoCust2", unit: "pcs", costPrice: 1, currentPrice: 2 });
    await seedStock(prisma, product.id, 3);
    const before = await rowCounts();

    await expectError(
      () =>
        saleService.createSale({
          paymentType: "CREDIT",
          customerId: "00000000-0000-0000-0000-000000000000",
          items: [{ productId: product.id, quantity: units(1) }],
        }),
      NotFoundError,
      /Customer/
    );
    expect(await rowCounts()).toEqual(before);
  });

  it("S10 invariant: CASH sale for a credit customer leaves balanceOwed untouched", async () => {
    const product = await createProduct(prisma, { name: "S10 Mix", unit: "pcs", costPrice: 200, currentPrice: 500 });
    const customerId = await createCustomer(prisma, "S10 Cash-on-credit-acct");
    await seedStock(prisma, product.id, 6);

    await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: units(2) }], // balance += 1000
    });

    const cashSale = await saleService.createSale({
      paymentType: "CASH",
      customerId,
      items: [{ productId: product.id, quantity: units(1) }], // should NOT touch the balance
    });

    expect(cashSale.total).toBe(500);
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(paisaFromDecimal(customer!.balanceOwed)).toBe(1000);

    const creditSales = await prisma.sale.findMany({ where: { paymentType: "CREDIT", customerId } });
    const creditTotal = creditSales.reduce((sum, s) => sum + paisaFromDecimal(s.total), 0);
    expect(creditTotal).toBe(1000);
  });
});