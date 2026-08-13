// D4/D5 customer-payment integration suite.
//
//   - D4: signed balanceOwed — overpayment becomes prepaid credit, consumed by
//         later CREDIT sales (-200 + 100 = -100)
//   - D5: optional saleId link verified three ways (exists / belongs / CREDIT)
//   - every payment deposits into the wallet (source CREDIT_PAYMENT)
//   - failures: 404 unknown customer, 404 unknown sale, 400 other-customer
//         sale, 400 non-CREDIT sale link — all zero-row side effects

import "dotenv/config";
import { strict as assert } from "node:assert";
import {
  BusinessRuleError,
  NotFoundError,
} from "../../lib/errors";
import { PrismaCustomerRepository } from "../../modules/customers/customer.repository";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SaleService } from "../../modules/sales/sale.service";
import { createDbSuite } from "../helpers/runner";
import { createProduct, createCustomer, seedStock } from "../helpers/seed";
import { createTestPrisma } from "../helpers/db";

const prisma = createTestPrisma();
const customerPaymentService = new CustomerPaymentService(prisma);
const saleService = new SaleService(prisma);
const customerRepository = new PrismaCustomerRepository(prisma);
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

async function customerBalance(customerId: string): Promise<number> {
  const customer = await customerRepository.findById(customerId);
  return customer!.balanceOwed;
}

await scenario("C1 D4 prepaid lifecycle: owe 200, pay 400 -> -200, consume 50 -> -150", async () => {
  const product = await createProduct(prisma, { name: "C1 Lifecycle", unit: "pcs", costPrice: 4, currentPrice: 10 });
  const customerId = await createCustomer(prisma, "C1 Prepaid");
  await seedStock(prisma, product.id, 50);

  await saleService.createSale({
    paymentType: "CREDIT",
    customerId,
    items: [{ productId: product.id, quantity: 20 }], // balance += 200
  });
  assert.equal(await customerBalance(customerId), 200);

  await customerPaymentService.createCustomerPayment({ customerId, amount: 400 });
  assert.equal(await customerBalance(customerId), -200, "D4: overpayment is prepaid credit");

  await saleService.createSale({
    paymentType: "CREDIT",
    customerId,
    items: [{ productId: product.id, quantity: 5 }], // balance += 50 -> -150
  });
  assert.equal(await customerBalance(customerId), -150, "D4: prepaid credit is consumed by a later CREDIT sale");

  const payments = await prisma.creditPayment.findMany({ where: { customerId } });
  assert.equal(payments.length, 1);
});

await scenario("C2 payment deposits the wallet (source CREDIT_PAYMENT)", async () => {
  const product = await createProduct(prisma, { name: "C2 Deposit", unit: "pcs", costPrice: 4, currentPrice: 10 });
  const customerId = await createCustomer(prisma, "C2 Depositor");
  await seedStock(prisma, product.id, 10);

  const payment = await customerPaymentService.createCustomerPayment({ customerId, amount: 250 });

  const rows = await prisma.walletTransaction.findMany({
    where: { type: "DEPOSIT", source: "CREDIT_PAYMENT", creditPaymentId: payment.id },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount.toNumber(), 250);
  assert.equal(await customerBalance(customerId), -250, "lump-sum against zero balance is prepaid (D4)");
});

await scenario("C3 D5: sale-linked payment succeeds and reduces the balance", async () => {
  const product = await createProduct(prisma, { name: "C3 Linked", unit: "pcs", costPrice: 3, currentPrice: 6 });
  const customerId = await createCustomer(prisma, "C3 Sale Linker");
  await seedStock(prisma, product.id, 10);

  const sale = await saleService.createSale({
    paymentType: "CREDIT",
    customerId,
    items: [{ productId: product.id, quantity: 5 }], // balance += 30
  });

  const payment = await customerPaymentService.createCustomerPayment({
    customerId,
    amount: 20,
    saleId: sale.id,
  });
  assert.equal(payment.saleId, sale.id);
  assert.equal(await customerBalance(customerId), 10, "D5: balance arithmetic unchanged by the link");
});

await scenario("C4 failure: unknown customer -> 404", async () => {
  const before = {
    payments: await prisma.creditPayment.count(),
    wallet: await prisma.walletTransaction.count(),
  };
  await expectError(
    () =>
      customerPaymentService.createCustomerPayment({
        customerId: "00000000-0000-0000-0000-000000000000",
        amount: 50,
      }),
    NotFoundError,
    /Customer/
  );
  assert.deepEqual(
    { payments: await prisma.creditPayment.count(), wallet: await prisma.walletTransaction.count() },
    before
  );
});

await scenario("C5 failure: saleId of a nonexistent sale -> 404", async () => {
  const customerId = await createCustomer(prisma, "C5 Ghost Sale");
  const before = {
    payments: await prisma.creditPayment.count(),
    wallet: await prisma.walletTransaction.count(),
  };
  await expectError(
    () =>
      customerPaymentService.createCustomerPayment({
        customerId,
        amount: 50,
        saleId: "00000000-0000-0000-0000-000000000000",
      }),
    NotFoundError,
    /Sale/
  );
  assert.deepEqual(
    { payments: await prisma.creditPayment.count(), wallet: await prisma.walletTransaction.count() },
    before
  );
});

await scenario("C6 failure: sale belongs to another customer -> 400", async () => {
  const product = await createProduct(prisma, { name: "C6 Wrong Owner", unit: "pcs", costPrice: 4, currentPrice: 8 });
  const owner = await createCustomer(prisma, "C6 Owner");
  const payer = await createCustomer(prisma, "C6 Payer");
  await seedStock(prisma, product.id, 10);

  const sale = await saleService.createSale({
    paymentType: "CREDIT",
    customerId: owner,
    items: [{ productId: product.id, quantity: 2 }],
  });

  await expectError(
    () =>
      customerPaymentService.createCustomerPayment({
        customerId: payer,
        amount: 10,
        saleId: sale.id,
      }),
    BusinessRuleError,
    /does not belong/
  );
  assert.equal(await customerBalance(owner), 16, "owner's balance untouched");
  assert.equal(await customerBalance(payer), 0);
  assert.equal(await prisma.walletTransaction.count(), 0, "no wallet deposit on a rejected link");
});

await scenario("C7 failure: saleId of a CASH sale -> 400", async () => {
  const product = await createProduct(prisma, { name: "C7 Cash Sale Link", unit: "pcs", costPrice: 4, currentPrice: 8 });
  const customerId = await createCustomer(prisma, "C7 Cash Buyer");
  await seedStock(prisma, product.id, 10);

  // A CASH sale may attach a customerId, but it is already paid at the
  // counter — no credit payment may link to it (D5).
  const sale = await saleService.createSale({
    paymentType: "CASH",
    customerId,
    items: [{ productId: product.id, quantity: 1 }],
  });

  await expectError(
    () =>
      customerPaymentService.createCustomerPayment({
        customerId,
        amount: 10,
        saleId: sale.id,
      }),
    BusinessRuleError,
    /CREDIT sales/
  );
  assert.equal(await prisma.creditPayment.count(), 0);
});

await scenario("C8 CREDIT lifecycle round trip keeps balance signed and consistent", async () => {
  const product = await createProduct(prisma, { name: "C8 Round Trip", unit: "pcs", costPrice: 4, currentPrice: 10 });
  const customerId = await createCustomer(prisma, "C8 Round Tripper");
  await seedStock(prisma, product.id, 50);

  // CREDIT 100 -> pay 250 (D4 prepaid) -> CREDIT 60 -> pay 40.
  await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: 10 }] });
  await customerPaymentService.createCustomerPayment({ customerId, amount: 250 });
  await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: 6 }] });
  await customerPaymentService.createCustomerPayment({ customerId, amount: 40 });

  assert.equal(await customerBalance(customerId), -130, "100 - 250 + 60 - 40 = -130");
  // Reconcile (auto) cross-checks balanceOwed == Σ credit sales − Σ payments.
  const creditSales = await prisma.sale.findMany({ where: { paymentType: "CREDIT", customerId } });
  const payments = await prisma.creditPayment.findMany({ where: { customerId } });
  const expected = creditSales.reduce((s, x) => s + x.total.toNumber(), 0) -
    payments.reduce((s, x) => s + x.amount.toNumber(), 0);
  assert.equal(await customerBalance(customerId), expected, "D4 identity holds");
});

const code = finish();
await prisma.$disconnect();
process.exit(code);