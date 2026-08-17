// Cross-module ledger suite (Vitest).
//
// One "kitchen-sink" lifecycle touching purchases (CASH/CREDIT), sales
// (CASH/ECASH/CREDIT), supplier payments, customer payments, DAMAGE and
// CORRECTION, then re-derives every reconciliation identity directly from raw
// SQL — independent of `reconcile` and of the services — so the harness and
// the business invariants are both cross-checked against the actual rows.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { SaleService } from "../../modules/sales/sale.service";
import { StockService } from "../../modules/stock/stock.service";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import { createProduct, createCustomer, createSupplier, units } from "../helpers/seed";

const prisma = createTestPrisma();
const purchaseService = new PurchaseService(prisma);
const saleService = new SaleService(prisma);
const stockService = new StockService(prisma);
const customerPaymentService = new CustomerPaymentService(prisma);
const supplierPaymentService = new SupplierPaymentService(prisma);
const productRepository = new PrismaProductRepository(prisma);

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

async function sqlScalar(query: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(query);
  return Number(rows[0].v);
}

describe("cross-module ledger", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("L1 full lifecycle: all ledgers agree with raw-SQL re-derivations", async () => {
    // Domain seeds are paisa; the DB stores rupees. All raw-SQL assertions
    // below are therefore in rupees (2000 paisa = Rs. 20.00).
    const a = await createProduct(prisma, { name: "L1 Rice", unit: "kg", costPrice: 2000, currentPrice: 2000 });
    const b = await createProduct(prisma, { name: "L1 Oil", unit: "liter", costPrice: 3000, currentPrice: 3000 });
    const supplierId = await createSupplier(prisma, "L1 Wholesale");
    const customerId = await createCustomer(prisma, "L1 Customer");

    // 1. CASH purchase A 10 @ 2000  -> wallet -200.00
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: a.id, quantity: units(10), costPerUnit: 2000 }],
    });
    // 2. CREDIT purchase B 5 @ 3000  -> supplier owes 150.00
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: b.id, quantity: units(5), costPerUnit: 3000 }],
    });
    // 3. CASH sale A 3 (2000 each)   -> wallet +60.00, stock A = 7
    await saleService.createSale({ paymentType: "CASH", items: [{ productId: a.id, quantity: units(3) }] });
    // 4. ECASH sale B 2 (3000 each)  -> wallet +60.00, stock B = 3
    await saleService.createSale({ paymentType: "ECASH", items: [{ productId: b.id, quantity: units(2) }] });
    // 5. CREDIT sale B 1 (3000)      -> customer owes 30.00, stock B = 2
    await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: b.id, quantity: units(1) }] });
    // 6. supplier payment 5000       -> owes 100.00, wallet -50.00
    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 5000 });
    // 7. customer payment 1000       -> owes 20.00, wallet +10.00
    await customerPaymentService.createCustomerPayment({ customerId, amount: 1000 });
    // 8. DAMAGE A 2                  -> stock A = 5
    await stockService.adjustStock({ productId: a.id, reason: "DAMAGE", quantity: 2 });
    // 9. CORRECTION B target 4        -> +2, stock B = 4
    await stockService.adjustStock({ productId: b.id, reason: "CORRECTION", quantity: 4 });

    // ── wallet (D3/D1) ──────────────────────────────────────────────────────
    const deposits = await sqlScalar(
      `SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='DEPOSIT'`
    );
    const withdrawals = await sqlScalar(
      `SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='WITHDRAWAL'`
    );
    expect(deposits).toBe(130);
    expect(withdrawals).toBe(250);
    expect(Math.abs(deposits - withdrawals - -120)).toBeLessThan(1e-6);

    // ── D6 stock identity per product (raw SQL) ─────────────────────────────
    const stockRows = await prisma.$queryRawUnsafe<{ id: string; qty: number }[]>(`
      SELECT p.id, p.stock_qty::text AS qty FROM products p
    `);
    const sumRows = await prisma.$queryRawUnsafe<{ product_id: string; total: number }[]>(`
      SELECT product_id, COALESCE(SUM(qty_change),0)::text AS total
      FROM stock_movements GROUP BY product_id
    `);
    const sumByProduct = new Map(sumRows.map((r) => [r.product_id, Number(r.total)]));
    for (const row of stockRows) {
      expect(Number(row.qty)).toBe(sumByProduct.get(row.id));
    }

    // ── D3 supplier balance (raw SQL) ───────────────────────────────────────
    const supplierSql = await prisma.$queryRawUnsafe<{ id: string; bal: number }[]>(`
      SELECT s.id, s.balance_owed::text AS bal FROM suppliers s
    `);
    const creditPurchasesSql = await sqlScalar(
      `SELECT COALESCE(SUM(total),0)::text AS v FROM purchases WHERE payment_type='CREDIT' AND supplier_id='${supplierId}'`
    );
    const supplierPaymentsSql = await sqlScalar(
      `SELECT COALESCE(SUM(amount),0)::text AS v FROM supplier_payments WHERE supplier_id='${supplierId}'`
    );
    expect(Number(supplierSql[0].bal)).toBe(100);
    expect(close(
      Number(supplierSql[0].bal),
      creditPurchasesSql - supplierPaymentsSql
    )).toBe(true);

    // ── D4 customer balance (raw SQL) ───────────────────────────────────────
    const customerSql = await prisma.$queryRawUnsafe<{ id: string; bal: number }[]>(`
      SELECT c.id, c.balance_owed::text AS bal FROM customers c
    `);
    const creditSalesSql = await sqlScalar(
      `SELECT COALESCE(SUM(total),0)::text AS v FROM sales WHERE payment_type='CREDIT' AND customer_id='${customerId}'`
    );
    const customerPaymentsSql = await sqlScalar(
      `SELECT COALESCE(SUM(amount),0)::text AS v FROM credit_payments WHERE customer_id='${customerId}'`
    );
    expect(Number(customerSql[0].bal)).toBe(20);
    expect(close(Number(customerSql[0].bal), creditSalesSql - customerPaymentsSql)).toBe(true);

    // ── D2 latest cost ──────────────────────────────────────────────────────
    const freshB = await productRepository.findById(b.id);
    expect(freshB!.costPrice).toBe(3000);
  });

  it("L2 prepaid credit consumed by later sales keeps every ledger consistent", async () => {
    // Domain seeds are paisa; SQL assertions below are rupees.
    const product = await createProduct(prisma, { name: "L2 Prepaid Cycle", unit: "pcs", costPrice: 400, currentPrice: 1000 });
    const customerId = await createCustomer(prisma, "L2 Advance Buyer");

    // Prepay Rs. 1000 (100000 paisa) with zero debt -> -1000.00 (D4 prepaid).
    await customerPaymentService.createCustomerPayment({ customerId, amount: 100000 });
    // Stock arrives via CASH purchase so the credit sales can consume it.
    const supplierId = await createSupplier(prisma, "L2 Stock Source");
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(100), costPerUnit: 400 }], // wallet -400.00
    });
    // CREDIT sales consume the prepaid credit (signed add).
    await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: units(50) }] }); // +500.00
    await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: units(25) }] }); // +250.00

    const balance = await sqlScalar(`SELECT balance_owed::text AS v FROM customers WHERE id='${customerId}'`);
    expect(balance).toBe(-250);

    const expectedDeposits = await sqlScalar(
      `SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='DEPOSIT'`
    );
    expect(expectedDeposits).toBe(1000);
  });
});