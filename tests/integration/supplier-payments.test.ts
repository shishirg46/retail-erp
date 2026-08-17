// D3 supplier-payment integration suite (Vitest).
//
// A supplier payment always withdraws from the wallet in the same transaction
// that reduces what the shop owes the supplier. CASH purchases debit the wallet
// at purchase time, so a credit-purchase-then-pay lifecycle moves money exactly
// once at the payment.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../../lib/errors";
import { paisaFromDecimal } from "../../lib/money";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, createSupplier, units } from "../helpers/seed";

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
    const product = await createProduct(prisma, { name: "SP1 Rice", unit: "kg", costPrice: 1000, currentPrice: 1400 });
    const supplierId = await createSupplier(prisma, "SP1 Wholesale");

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: units(10), costPerUnit: 1000 }], // owes 10000
    });
    expect(await supplierBalance(supplierId)).toBe(10000);
    expect(await prisma.walletTransaction.count()).toBe(0);

    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 4000 });
    expect(await supplierBalance(supplierId)).toBe(6000);
    const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    expect(rows.length).toBe(1);
    expect(paisaFromDecimal(rows[0].amount)).toBe(4000);
  });

  it("SP2 over-payment: balance goes signed-negative, wallet debits the full amount", async () => {
    const product = await createProduct(prisma, { name: "SP2 Overpay", unit: "pcs", costPrice: 200, currentPrice: 400 });
    const supplierId = await createSupplier(prisma, "SP2 Overpayer");

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: units(5), costPerUnit: 200 }], // owes 1000
    });

    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 1500 });
    expect(await supplierBalance(supplierId)).toBe(-500);
    const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    expect(rows.reduce((s, r) => s + paisaFromDecimal(r.amount), 0)).toBe(1500);
  });

  it("SP3 CASH purchase + no separate payment: wallet debited exactly once", async () => {
    const product = await createProduct(prisma, { name: "SP3 CashBuy", unit: "pcs", costPrice: 300, currentPrice: 500 });
    const supplierId = await createSupplier(prisma, "SP3 Cash");

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(4), costPerUnit: 300 }], // wallet -1200
    });

    expect(await supplierBalance(supplierId)).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(1);

    const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    expect(paisaFromDecimal(rows[0].amount)).toBe(1200);
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
          amount: 5000,
        }),
      NotFoundError,
      /Supplier/
    );
    expect(
      { payments: await prisma.supplierPayment.count(), wallet: await prisma.walletTransaction.count() }
    ).toEqual(before);
  });

  it("SP5 supplier ledger stays reconciled after a mixed cash/credit history", async () => {
    const product = await createProduct(prisma, { name: "SP5 Mixed", unit: "pcs", costPrice: 200, currentPrice: 400 });
    const supplierId = await createSupplier(prisma, "SP5 Mixed History");

    await purchaseService.createPurchase({ // CASH — wallet -2000, balance 0
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(5), costPerUnit: 400 }],
    });
    await purchaseService.createPurchase({ // CREDIT — balance 6000
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: units(10), costPerUnit: 600 }],
    });
    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 7000 }); // balance -1000

    expect(await supplierBalance(supplierId)).toBe(-1000);

    const creditPurchases = await prisma.purchase.findMany({ where: { paymentType: "CREDIT", supplierId } });
    const payments = await prisma.supplierPayment.findMany({ where: { supplierId } });
    const expected = creditPurchases.reduce((s, x) => s + paisaFromDecimal(x.total), 0) -
      payments.reduce((s, x) => s + paisaFromDecimal(x.amount), 0);
    expect(await supplierBalance(supplierId)).toBe(expected);

    const withdrawals = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
    const totalOut = withdrawals.reduce((s, x) => s + paisaFromDecimal(x.amount), 0);
    expect(totalOut).toBe(2000 + 7000);
  });
});