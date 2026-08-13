// D4/D5 customer-payment integration suite (Vitest).
//
//   - D4: signed balanceOwed — overpayment becomes prepaid credit, consumed by
//         later CREDIT sales (-200 + 100 = -100)
//   - D5: optional saleId link verified three ways (exists / belongs / CREDIT)
//   - every payment deposits into the wallet (source CREDIT_PAYMENT)
//   - failures: 404 unknown customer, 404 unknown sale, 400 other-customer
//         sale, 400 non-CREDIT sale link — all zero-row side effects

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BusinessRuleError,
  NotFoundError,
} from "../../lib/errors";
import { PrismaCustomerRepository } from "../../modules/customers/customer.repository";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SaleService } from "../../modules/sales/sale.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, createCustomer, seedStock } from "../helpers/seed";

const prisma = createTestPrisma();
const customerPaymentService = new CustomerPaymentService(prisma);
const saleService = new SaleService(prisma);
const customerRepository = new PrismaCustomerRepository(prisma);

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

async function customerBalance(customerId: string): Promise<number> {
  const customer = await customerRepository.findById(customerId);
  return customer!.balanceOwed;
}

describe("customer payments (D4/D5)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("C1 D4 prepaid lifecycle: owe 200, pay 400 -> -200, consume 50 -> -150", async () => {
    const product = await createProduct(prisma, { name: "C1 Lifecycle", unit: "pcs", costPrice: 4, currentPrice: 10 });
    const customerId = await createCustomer(prisma, "C1 Prepaid");
    await seedStock(prisma, product.id, 50);

    await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: 20 }], // balance += 200
    });
    expect(await customerBalance(customerId)).toBe(200);

    await customerPaymentService.createCustomerPayment({ customerId, amount: 400 });
    expect(await customerBalance(customerId)).toBe(-200);

    await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: 5 }], // balance += 50 -> -150
    });
    expect(await customerBalance(customerId)).toBe(-150);

    const payments = await prisma.creditPayment.findMany({ where: { customerId } });
    expect(payments.length).toBe(1);
  });

  it("C2 payment deposits the wallet (source CREDIT_PAYMENT)", async () => {
    const product = await createProduct(prisma, { name: "C2 Deposit", unit: "pcs", costPrice: 4, currentPrice: 10 });
    const customerId = await createCustomer(prisma, "C2 Depositor");
    await seedStock(prisma, product.id, 10);

    const payment = await customerPaymentService.createCustomerPayment({ customerId, amount: 250 });

    const rows = await prisma.walletTransaction.findMany({
      where: { type: "DEPOSIT", source: "CREDIT_PAYMENT", creditPaymentId: payment.id },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].amount.toNumber()).toBe(250);
    expect(await customerBalance(customerId)).toBe(-250);
  });

  it("C3 D5: sale-linked payment succeeds and reduces the balance", async () => {
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
    expect(payment.saleId).toBe(sale.id);
    expect(await customerBalance(customerId)).toBe(10);
  });

  it("C4 failure: unknown customer -> 404", async () => {
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
    expect(
      { payments: await prisma.creditPayment.count(), wallet: await prisma.walletTransaction.count() }
    ).toEqual(before);
  });

  it("C5 failure: saleId of a nonexistent sale -> 404", async () => {
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
    expect(
      { payments: await prisma.creditPayment.count(), wallet: await prisma.walletTransaction.count() }
    ).toEqual(before);
  });

  it("C6 failure: sale belongs to another customer -> 400", async () => {
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
    expect(await customerBalance(owner)).toBe(16);
    expect(await customerBalance(payer)).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  it("C7 failure: saleId of a CASH sale -> 400", async () => {
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
    expect(await prisma.creditPayment.count()).toBe(0);
  });

  it("C8 CREDIT lifecycle round trip keeps balance signed and consistent", async () => {
    const product = await createProduct(prisma, { name: "C8 Round Trip", unit: "pcs", costPrice: 4, currentPrice: 10 });
    const customerId = await createCustomer(prisma, "C8 Round Tripper");
    await seedStock(prisma, product.id, 50);

    // CREDIT 100 -> pay 250 (D4 prepaid) -> CREDIT 60 -> pay 40.
    await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: 10 }] });
    await customerPaymentService.createCustomerPayment({ customerId, amount: 250 });
    await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: 6 }] });
    await customerPaymentService.createCustomerPayment({ customerId, amount: 40 });

    expect(await customerBalance(customerId)).toBe(-130);
    const creditSales = await prisma.sale.findMany({ where: { paymentType: "CREDIT", customerId } });
    const payments = await prisma.creditPayment.findMany({ where: { customerId } });
    const expected = creditSales.reduce((s, x) => s + x.total.toNumber(), 0) -
      payments.reduce((s, x) => s + x.amount.toNumber(), 0);
    expect(await customerBalance(customerId)).toBe(expected);
  });
});