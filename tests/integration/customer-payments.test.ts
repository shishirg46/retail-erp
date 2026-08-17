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
import { paisaFromDecimal } from "../../lib/money";
import { PrismaCustomerRepository } from "../../modules/customers/customer.repository";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SaleService } from "../../modules/sales/sale.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, createCustomer, seedStock, units } from "../helpers/seed";

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

  it("C1 D4 prepaid lifecycle: owe 20000, pay 40000 -> -20000, consume 5000 -> -15000", async () => {
    const product = await createProduct(prisma, { name: "C1 Lifecycle", unit: "pcs", costPrice: 400, currentPrice: 1000 });
    const customerId = await createCustomer(prisma, "C1 Prepaid");
    await seedStock(prisma, product.id, 50);

    await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: units(20) }], // balance += 20000
    });
    expect(await customerBalance(customerId)).toBe(20000);

    await customerPaymentService.createCustomerPayment({ customerId, amount: 40000 });
    expect(await customerBalance(customerId)).toBe(-20000);

    await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: units(5) }], // balance += 5000 -> -15000
    });
    expect(await customerBalance(customerId)).toBe(-15000);

    const payments = await prisma.creditPayment.findMany({ where: { customerId } });
    expect(payments.length).toBe(1);
  });

  it("C2 payment deposits the wallet (source CREDIT_PAYMENT)", async () => {
    const product = await createProduct(prisma, { name: "C2 Deposit", unit: "pcs", costPrice: 400, currentPrice: 1000 });
    const customerId = await createCustomer(prisma, "C2 Depositor");
    await seedStock(prisma, product.id, 10);

    const payment = await customerPaymentService.createCustomerPayment({ customerId, amount: 25000 });

    const rows = await prisma.walletTransaction.findMany({
      where: { type: "DEPOSIT", source: "CREDIT_PAYMENT", creditPaymentId: payment.id },
    });
    expect(rows.length).toBe(1);
    expect(paisaFromDecimal(rows[0].amount)).toBe(25000);
    expect(await customerBalance(customerId)).toBe(-25000);
  });

  it("C3 D5: sale-linked payment succeeds and reduces the balance", async () => {
    const product = await createProduct(prisma, { name: "C3 Linked", unit: "pcs", costPrice: 300, currentPrice: 600 });
    const customerId = await createCustomer(prisma, "C3 Sale Linker");
    await seedStock(prisma, product.id, 10);

    const sale = await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: units(5) }], // balance += 3000
    });

    const payment = await customerPaymentService.createCustomerPayment({
      customerId,
      amount: 2000,
      saleId: sale.id,
    });
    expect(payment.saleId).toBe(sale.id);
    expect(await customerBalance(customerId)).toBe(1000);
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
          amount: 5000,
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
          amount: 5000,
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
    const product = await createProduct(prisma, { name: "C6 Wrong Owner", unit: "pcs", costPrice: 400, currentPrice: 800 });
    const owner = await createCustomer(prisma, "C6 Owner");
    const payer = await createCustomer(prisma, "C6 Payer");
    await seedStock(prisma, product.id, 10);

    const sale = await saleService.createSale({
      paymentType: "CREDIT",
      customerId: owner,
      items: [{ productId: product.id, quantity: units(2) }],
    });

    await expectError(
      () =>
        customerPaymentService.createCustomerPayment({
          customerId: payer,
          amount: 1000,
          saleId: sale.id,
        }),
      BusinessRuleError,
      /does not belong/
    );
    expect(await customerBalance(owner)).toBe(1600);
    expect(await customerBalance(payer)).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  it("C7 failure: saleId of a CASH sale -> 400", async () => {
    const product = await createProduct(prisma, { name: "C7 Cash Sale Link", unit: "pcs", costPrice: 400, currentPrice: 800 });
    const customerId = await createCustomer(prisma, "C7 Cash Buyer");
    await seedStock(prisma, product.id, 10);

    // A CASH sale may attach a customerId, but it is already paid at the
    // counter — no credit payment may link to it (D5).
    const sale = await saleService.createSale({
      paymentType: "CASH",
      customerId,
      items: [{ productId: product.id, quantity: units(1) }],
    });

    await expectError(
      () =>
        customerPaymentService.createCustomerPayment({
          customerId,
          amount: 1000,
          saleId: sale.id,
        }),
      BusinessRuleError,
      /CREDIT sales/
    );
    expect(await prisma.creditPayment.count()).toBe(0);
  });

  it("C8 CREDIT lifecycle round trip keeps balance signed and consistent", async () => {
    const product = await createProduct(prisma, { name: "C8 Round Trip", unit: "pcs", costPrice: 400, currentPrice: 1000 });
    const customerId = await createCustomer(prisma, "C8 Round Tripper");
    await seedStock(prisma, product.id, 50);

    // CREDIT 10000 -> pay 25000 (D4 prepaid) -> CREDIT 6000 -> pay 4000.
    await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: units(10) }] });
    await customerPaymentService.createCustomerPayment({ customerId, amount: 25000 });
    await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: units(6) }] });
    await customerPaymentService.createCustomerPayment({ customerId, amount: 4000 });

    expect(await customerBalance(customerId)).toBe(-13000);
    const creditSales = await prisma.sale.findMany({ where: { paymentType: "CREDIT", customerId } });
    const payments = await prisma.creditPayment.findMany({ where: { customerId } });
    const expected = creditSales.reduce((s, x) => s + paisaFromDecimal(x.total), 0) -
      payments.reduce((s, x) => s + paisaFromDecimal(x.amount), 0);
    expect(await customerBalance(customerId)).toBe(expected);
  });
});