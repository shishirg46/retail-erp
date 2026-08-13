// D3 supplier-payment integration suite (Vitest).
//
// A supplier payment always withdraws from the wallet in the same transaction
// that reduces what the shop owes the supplier. CASH purchases debit the wallet
// at purchase time, so a credit-purchase-then-pay lifecycle moves money exactly
// once at the payment.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../../lib/errors";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, createSupplier } from "../helpers/seed";

const prisma = createTestPrisma();
const supplierPaymentService = new SupplierPaymentService(prisma);
const purchaseService = new PurchaseService(prisma);
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

async function supplierBalance(supplierId: string): Promise<number> {
  const supplier = await supplierRepository.findById(supplierId);
  return supplier!.balanceOwed;
}

describe("supplier payments (D3)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("SP1 credit purchase then partial payment: balance drops, wallet debited once", async () => {
    const product = await createProduct(prisma, { name: "SP1 Rice", unit: "kg", costPrice: 10, currentPrice: 14 });
    const supplierId = await createSupplier(prisma, "SP1 Wholesale");

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: 10, costPerUnit: 10 }], // owes 100
    });
    expect(await supplierBalance(supplierId)).toBe(100);
    expect(await prisma.walletTransaction.count()).toBe(0);

    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 40 });
    expect(await supplierBalance(supplierId)).toBe(60);
    const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    expect(rows.length).toBe(1);
    expect(rows[0].amount.toNumber()).toBe(40);
  });

  it("SP2 over-payment: balance goes signed-negative, wallet debits the full amount", async () => {
    const product = await createProduct(prisma, { name: "SP2 Overpay", unit: "pcs", costPrice: 2, currentPrice: 4 });
    const supplierId = await createSupplier(prisma, "SP2 Overpayer");

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: 5, costPerUnit: 2 }], // owes 10
    });

    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 15 });
    expect(await supplierBalance(supplierId)).toBe(-5);
    const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    expect(rows.reduce((s, r) => s + r.amount.toNumber(), 0)).toBe(15);
  });

  it("SP3 CASH purchase + no separate payment: wallet debited exactly once", async () => {
    const product = await createProduct(prisma, { name: "SP3 CashBuy", unit: "pcs", costPrice: 3, currentPrice: 5 });
    const supplierId = await createSupplier(prisma, "SP3 Cash");

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 4, costPerUnit: 3 }], // wallet -12
    });

    expect(await supplierBalance(supplierId)).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(1);

    const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    expect(rows[0].amount.toNumber()).toBe(12);
  });

  it("SP4 failure: unknown supplier -> 404, zero rows", async () => {
    const before = {
      payments: await prisma.supplierPayment.count(),
      wallet: await prisma.walletTransaction.count(),
    };
    await expectError(
      () =>
        supplierPaymentService.createSupplierPayment({
          supplierId: "00000000-0000-0000-0000-000000000000",
          amount: 50,
        }),
      NotFoundError,
      /Supplier/
    );
    expect(
      { payments: await prisma.supplierPayment.count(), wallet: await prisma.walletTransaction.count() }
    ).toEqual(before);
  });

  it("SP5 supplier ledger stays reconciled after a mixed cash/credit history", async () => {
    const product = await createProduct(prisma, { name: "SP5 Mixed", unit: "pcs", costPrice: 2, currentPrice: 4 });
    const supplierId = await createSupplier(prisma, "SP5 Mixed History");

    await purchaseService.createPurchase({ // CASH — wallet -20, balance 0
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 5, costPerUnit: 4 }],
    });
    await purchaseService.createPurchase({ // CREDIT — balance 60
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: 10, costPerUnit: 6 }],
    });
    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 70 }); // balance -10

    expect(await supplierBalance(supplierId)).toBe(-10);

    const creditPurchases = await prisma.purchase.findMany({ where: { paymentType: "CREDIT", supplierId } });
    const payments = await prisma.supplierPayment.findMany({ where: { supplierId } });
    const expected = creditPurchases.reduce((s, x) => s + x.total.toNumber(), 0) -
      payments.reduce((s, x) => s + x.amount.toNumber(), 0);
    expect(await supplierBalance(supplierId)).toBe(expected);

    const withdrawals = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    const totalOut = withdrawals.reduce((s, x) => s + x.amount.toNumber(), 0);
    expect(totalOut).toBe(20 + 70);
  });
});