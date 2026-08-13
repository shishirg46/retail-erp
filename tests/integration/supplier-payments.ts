// D3 supplier-payment integration suite.
//
// A supplier payment always withdraws from the wallet in the same transaction
// that reduces what the shop owes the supplier. CASH purchases debit the wallet
// at purchase time, so a credit-purchase-then-pay lifecycle moves money exactly
// once at the payment.

import "dotenv/config";
import { strict as assert } from "node:assert";
import { NotFoundError } from "../../lib/errors";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { createDbSuite } from "../helpers/runner";
import { createProduct, createSupplier } from "../helpers/seed";
import { createTestPrisma } from "../helpers/db";

const prisma = createTestPrisma();
const supplierPaymentService = new SupplierPaymentService(prisma);
const purchaseService = new PurchaseService(prisma);
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

async function supplierBalance(supplierId: string): Promise<number> {
  const supplier = await supplierRepository.findById(supplierId);
  return supplier!.balanceOwed;
}

await scenario("SP1 credit purchase then partial payment: balance drops, wallet debited once", async () => {
  const product = await createProduct(prisma, { name: "SP1 Rice", unit: "kg", costPrice: 10, currentPrice: 14 });
  const supplierId = await createSupplier(prisma, "SP1 Wholesale");

  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CREDIT",
    items: [{ productId: product.id, quantity: 10, costPerUnit: 10 }], // owes 100
  });
  assert.equal(await supplierBalance(supplierId), 100);
  assert.equal(await prisma.walletTransaction.count(), 0, "CREDIT purchase creates no wallet row");

  await supplierPaymentService.createSupplierPayment({ supplierId, amount: 40 });
  assert.equal(await supplierBalance(supplierId), 60, "D3: payment reduces what the shop owes");
  const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount.toNumber(), 40, "D3: wallet debited by the payment amount");
});

await scenario("SP2 over-payment: balance goes signed-negative, wallet debits the full amount", async () => {
  const product = await createProduct(prisma, { name: "SP2 Overpay", unit: "pcs", costPrice: 2, currentPrice: 4 });
  const supplierId = await createSupplier(prisma, "SP2 Overpayer");

  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CREDIT",
    items: [{ productId: product.id, quantity: 5, costPerUnit: 2 }], // owes 10
  });

  await supplierPaymentService.createSupplierPayment({ supplierId, amount: 15 });
  assert.equal(await supplierBalance(supplierId), -5, "payment above the balance is allowed and signed");
  const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
  assert.equal(rows.reduce((s, r) => s + r.amount.toNumber(), 0), 15);
});

await scenario("SP3 CASH purchase + no separate payment: wallet debited exactly once", async () => {
  const product = await createProduct(prisma, { name: "SP3 CashBuy", unit: "pcs", costPrice: 3, currentPrice: 5 });
  const supplierId = await createSupplier(prisma, "SP3 Cash");

  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CASH",
    items: [{ productId: product.id, quantity: 4, costPerUnit: 3 }], // wallet -12
  });

  assert.equal(await supplierBalance(supplierId), 0, "CASH purchase never raises the balance");
  assert.equal(await prisma.walletTransaction.count(), 1, "single CASH-purchase withdrawal");

  const rows = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
  assert.equal(rows[0].amount.toNumber(), 12);
});

await scenario("SP4 failure: unknown supplier -> 404, zero rows", async () => {
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
  assert.deepEqual(
    { payments: await prisma.supplierPayment.count(), wallet: await prisma.walletTransaction.count() },
    before
  );
});

await scenario("SP5 supplier ledger stays reconciled after a mixed cash/credit history", async () => {
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

  assert.equal(await supplierBalance(supplierId), -10);

  const creditPurchases = await prisma.purchase.findMany({ where: { paymentType: "CREDIT", supplierId } });
  const payments = await prisma.supplierPayment.findMany({ where: { supplierId } });
  const expected = creditPurchases.reduce((s, x) => s + x.total.toNumber(), 0) -
    payments.reduce((s, x) => s + x.amount.toNumber(), 0);
  assert.equal(await supplierBalance(supplierId), expected, "D3 identity: balance == Σ CREDIT purchases − Σ payments");

  const withdrawals = await prisma.walletTransaction.findMany({ where: { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT" } });
  const totalOut = withdrawals.reduce((s, x) => s + x.amount.toNumber(), 0);
  assert.equal(totalOut, 20 + 70, "wallet outflows: CASH purchase 20 + payment 70");
});

const code = finish();
await prisma.$disconnect();
process.exit(code);