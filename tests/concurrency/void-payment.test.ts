// F-08 concurrency regression suite (Vitest).
//
// Proves the D18.11 serialization: a Sale can never be voided concurrently
// with the creation of a CreditPayment linked to that Sale. Under READ
// COMMITTED, without the SELECT ... FOR UPDATE row lock on `sales`, both
// operations can read each other's pre-write state and BOTH succeed — leaving
// an active CreditPayment on a voided Sale (the D18.4-forbidden state). The
// ledger invariants still hold in that corrupted state, so this suite asserts
// the Sale/CreditPayment/VoidRecord triangle directly, per race:
//
//   - void commits first    -> payment rejected ("voided sale")
//   - payment commits first -> void rejected ("voided first")
//
// Exactly one of the two may win; the loser must observe the winner's
// committed state and be rejected. No active CreditPayment may ever sit on a
// voided Sale.
//
// Real races are created in-code with Promise.allSettled (never by running
// tests concurrently) and always run ONLY against the dedicated test database
// (TEST_DATABASE_URL guard in tests/helpers/db.ts). After every race the
// void-aware D3/D4/D6/wallet reconcile re-derives the ledger invariants from
// raw rows.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BusinessRuleError } from "../../lib/errors";
import { paisaFromDecimal } from "../../lib/money";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { PrismaCustomerRepository } from "../../modules/customers/customer.repository";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PrismaStockRepository } from "../../modules/stock/stock.repository";
import { SaleService } from "../../modules/sales/sale.service";
import { VoidService } from "../../modules/voids/void.service";
import { quantityToUnits } from "../../lib/quantity";
import { createTestPrisma, reconcile, truncateAll } from "../helpers/db";
import { createCustomer, createProduct, seedStock, units } from "../helpers/seed";

const prisma = createTestPrisma();

const productRepository = new PrismaProductRepository(prisma);
const customerRepository = new PrismaCustomerRepository(prisma);
const stockRepository = new PrismaStockRepository(prisma);
const saleService = new SaleService(prisma);
const customerPaymentService = new CustomerPaymentService(prisma);
const voidService = new VoidService(prisma);

const VOIDED_BY = "00000000-0000-0000-0000-000000000001";
const voidInput = { reason: "test void", voidedBy: VOIDED_BY };

const SALE_TOTAL = 2000; // 1 unit at currentPrice 2000 paisa
const PAYMENT_AMOUNT = 800;
const INITIAL_STOCK = 20;
const ITERATIONS = 12;

async function movementSum(productId: string): Promise<number> {
  const movements = await stockRepository.listByProduct(productId);
  return movements.reduce((sum, m) => sum + m.qtyChange, 0);
}

describe("F-08 void vs linked-payment concurrency (D18.11)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("races voidSale against createCustomerPayment per sale — exactly one wins", async () => {
    const product = await createProduct(prisma, {
      name: "F08 locked sale",
      unit: "pcs",
      costPrice: 1000,
      currentPrice: 2000,
    });
    const customerId = await createCustomer(prisma, "F08 credit");
    await seedStock(prisma, product.id, INITIAL_STOCK);

    let voidWins = 0;
    let paymentWins = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      const sale = await saleService.createSale({
        paymentType: "CREDIT",
        customerId,
        items: [{ productId: product.id, quantity: units(1) }],
      });

      const results = await Promise.allSettled([
        voidService.voidSale(sale.id, voidInput),
        customerPaymentService.createCustomerPayment({
          customerId,
          amount: PAYMENT_AMOUNT,
          saleId: sale.id,
        }),
      ]);

      const ok = results.filter((r) => r.status === "fulfilled");
      const err = results.filter((r) => r.status === "rejected");
      expect(ok.length).toBe(1);
      expect(err.length).toBe(1);

      const voided = await isVoidedSale(sale.id);
      const paymentCount = await prisma.creditPayment.count({
        where: { saleId: sale.id },
      });

      // The D18.4 invariant this suite protects: an active CreditPayment can
      // never coexist with the Sale being voided.
      expect(voided && paymentCount > 0).toBe(false);

      if (voided) {
        voidWins += 1;
        expect(paymentCount).toBe(0);
        const rejection = err[0].reason as Error;
        expect(rejection).toBeInstanceOf(BusinessRuleError);
        expect(rejection.message).toMatch(/voided sale/);
      } else {
        paymentWins += 1;
        expect(paymentCount).toBe(1);
        const rejection = err[0].reason as Error;
        expect(rejection).toBeInstanceOf(BusinessRuleError);
        expect(rejection.message).toMatch(/voided first/);
      }
    }

    // ── Aggregate consistency ──────────────────────────────────────────────
    // Every non-voided sale must carry its payment; every voided sale none.
    const voidedIds = (
      await prisma.voidRecord.findMany({ where: { targetType: "SALE" } })
    ).map((record) => record.targetId);

    const activeSales = await prisma.sale.count({
      where: { paymentType: "CREDIT", id: { notIn: voidedIds } },
    });
    expect(activeSales).toBe(paymentWins);
    expect(voidWins).toBe(ITERATIONS - paymentWins);

    // Every credit payment linked to a sale must point at an ACTIVE sale.
    const linkedPayments = await prisma.creditPayment.findMany({
      where: { saleId: { not: null } },
    });
    expect(linkedPayments.length).toBe(paymentWins);
    for (const payment of linkedPayments) {
      expect(voidedIds).not.toContain(payment.saleId);
    }

    // Customer balance: each payment-win sale contributes total − paid.
    const balance = await customerRepository.findById(customerId).then(
      (customer) => customer!.balanceOwed
    );
    expect(balance).toBe((SALE_TOTAL - PAYMENT_AMOUNT) * paymentWins);

    // Wallet: one DEPOSIT per winning payment, no withdrawals.
    const deposits = await prisma.walletTransaction.aggregate({
      where: { type: "DEPOSIT" },
      _sum: { amount: true },
    });
    const withdrawals = await prisma.walletTransaction.aggregate({
      where: { type: "WITHDRAWAL" },
      _sum: { amount: true },
    });
    expect(paisaFromDecimal(deposits._sum.amount)).toBe(PAYMENT_AMOUNT * paymentWins);
    expect(paisaFromDecimal(withdrawals._sum.amount)).toBe(0);

    // Stock: each winning payment sale consumed one unit (voided sales were
    // restored). D6 must reconcile.
    const stock = await productRepository.findById(product.id);
    expect(stock!.stockQty).toBe(quantityToUnits(INITIAL_STOCK - paymentWins));
    expect(await movementSum(product.id)).toBe(quantityToUnits(INITIAL_STOCK - paymentWins));

    expect(await reconcile(prisma)).toEqual([]);
  });
});

async function isVoidedSale(saleId: string): Promise<boolean> {
  const record = await prisma.voidRecord.findUnique({
    where: { targetType_targetId: { targetType: "SALE", targetId: saleId } },
  });
  return record !== null;
}
