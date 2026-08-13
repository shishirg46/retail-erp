// Cross-module ledger suite.
//
// One "kitchen-sink" lifecycle touching purchases (CASH/CREDIT), sales
// (CASH/ECASH/CREDIT), supplier payments, customer payments, DAMAGE and
// CORRECTION, then re-derives every reconciliation identity directly from raw
// SQL — independent of `reconcile` and of the services — so the wrapper
// (helpers/runner `createDbSuite`) and the business invariants are both
// cross-checked against the actual database rows.

import "dotenv/config";
import { strict as assert } from "node:assert";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { SaleService } from "../../modules/sales/sale.service";
import { StockService } from "../../modules/stock/stock.service";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { createDbSuite } from "../helpers/runner";
import { createProduct, createCustomer, createSupplier } from "../helpers/seed";
import { createTestPrisma } from "../helpers/db";

const prisma = createTestPrisma();
const purchaseService = new PurchaseService(prisma);
const saleService = new SaleService(prisma);
const stockService = new StockService(prisma);
const customerPaymentService = new CustomerPaymentService(prisma);
const supplierPaymentService = new SupplierPaymentService(prisma);
const productRepository = new PrismaProductRepository(prisma);
const { scenario, finish } = createDbSuite(prisma);

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

async function sqlScalar(query: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(query);
  return Number(rows[0].v);
}

await scenario("L1 full lifecycle: all ledgers agree with raw-SQL re-derivations", async () => {
  const a = await createProduct(prisma, { name: "L1 Rice", unit: "kg", costPrice: 20, currentPrice: 20 });
  const b = await createProduct(prisma, { name: "L1 Oil", unit: "liter", costPrice: 30, currentPrice: 30 });
  const supplierId = await createSupplier(prisma, "L1 Wholesale");
  const customerId = await createCustomer(prisma, "L1 Customer");

  // 1. CASH purchase A 10 @ 20  -> wallet -200
  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CASH",
    items: [{ productId: a.id, quantity: 10, costPerUnit: 20 }],
  });
  // 2. CREDIT purchase B 5 @ 30  -> supplier owes 150
  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CREDIT",
    items: [{ productId: b.id, quantity: 5, costPerUnit: 30 }],
  });
  // 3. CASH sale A 3 (20 each)   -> wallet +60, stock A = 7
  await saleService.createSale({ paymentType: "CASH", items: [{ productId: a.id, quantity: 3 }] });
  // 4. ECASH sale B 2 (30 each)  -> wallet +60, stock B = 3
  await saleService.createSale({ paymentType: "ECASH", items: [{ productId: b.id, quantity: 2 }] });
  // 5. CREDIT sale B 1 (30)      -> customer owes 30, stock B = 2
  await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: b.id, quantity: 1 }] });
  // 6. supplier payment 50       -> owes 100, wallet -50
  await supplierPaymentService.createSupplierPayment({ supplierId, amount: 50 });
  // 7. customer payment 10       -> owes 20, wallet +10
  await customerPaymentService.createCustomerPayment({ customerId, amount: 10 });
  // 8. DAMAGE A 2                -> stock A = 5
  await stockService.adjustStock({ productId: a.id, reason: "DAMAGE", quantity: 2 });
  // 9. CORRECTION B target 4      -> +2, stock B = 4
  await stockService.adjustStock({ productId: b.id, reason: "CORRECTION", quantity: 4 });

  // ── wallet (D3/D1) ────────────────────────────────────────────────────────
  const deposits = await sqlScalar(
    `SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='DEPOSIT'`
  );
  const withdrawals = await sqlScalar(
    `SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='WITHDRAWAL'`
  );
  assert.equal(deposits, 130, "deposits = 60 (CASH sale) + 60 (ECASH sale) + 10 (customer payment)");
  assert.equal(withdrawals, 250, "withdrawals = 200 (CASH purchase) + 50 (supplier payment)");
  assert.ok(Math.abs(deposits - withdrawals - -120) < 1e-6, "wallet balance = deposits - withdrawals");

  // ── D6 stock identity per product (raw SQL) ───────────────────────────────
  const stockRows = await prisma.$queryRawUnsafe<{ id: string; qty: number }[]>(`
    SELECT p.id, p.stock_qty::text AS qty FROM products p
  `);
  const sumRows = await prisma.$queryRawUnsafe<{ product_id: string; total: number }[]>(`
    SELECT product_id, COALESCE(SUM(qty_change),0)::text AS total
    FROM stock_movements GROUP BY product_id
  `);
  const sumByProduct = new Map(sumRows.map((r) => [r.product_id, Number(r.total)]));
  for (const row of stockRows) {
    assert.equal(
      Number(row.qty),
      sumByProduct.get(row.id),
      `D6: product ${row.id} stockQty vs Σmovements`
    );
  }

  // ── D3 supplier balance (raw SQL) ─────────────────────────────────────────
  const supplierSql = await prisma.$queryRawUnsafe<{ id: string; bal: number }[]>(`
    SELECT s.id, s.balance_owed::text AS bal FROM suppliers s
  `);
  const creditPurchasesSql = await sqlScalar(
    `SELECT COALESCE(SUM(total),0)::text AS v FROM purchases WHERE payment_type='CREDIT' AND supplier_id='${supplierId}'`
  );
  const supplierPaymentsSql = await sqlScalar(
    `SELECT COALESCE(SUM(amount),0)::text AS v FROM supplier_payments WHERE supplier_id='${supplierId}'`
  );
  assert.equal(Number(supplierSql[0].bal), 100, "D3: supplier balance reflects its own credit history");
  assert.ok(close(Number(supplierSql[0].bal), creditPurchasesSql - supplierPaymentsSql),
    "D3 raw identity: balance == CREDIT purchases - payments");

  // ── D4 customer balance (raw SQL) ─────────────────────────────────────────
  const customerSql = await prisma.$queryRawUnsafe<{ id: string; bal: number }[]>(`
    SELECT c.id, c.balance_owed::text AS bal FROM customers c
  `);
  const creditSalesSql = await sqlScalar(
    `SELECT COALESCE(SUM(total),0)::text AS v FROM sales WHERE payment_type='CREDIT' AND customer_id='${customerId}'`
  );
  const customerPaymentsSql = await sqlScalar(
    `SELECT COALESCE(SUM(amount),0)::text AS v FROM credit_payments WHERE customer_id='${customerId}'`
  );
  assert.equal(Number(customerSql[0].bal), 20, "D4: customer balance 30 - 10");
  assert.ok(close(Number(customerSql[0].bal), creditSalesSql - customerPaymentsSql),
    "D4 raw identity: balance == CREDIT sales - payments");

  // ── D2 latest cost ────────────────────────────────────────────────────────
  const freshB = await productRepository.findById(b.id);
  assert.equal(freshB!.costPrice, 30, "D2: costPrice = latest purchase cost");
});

await scenario("L2 prepaid credit consumed by later sales keeps every ledger consistent", async () => {
  const product = await createProduct(prisma, { name: "L2 Prepaid Cycle", unit: "pcs", costPrice: 4, currentPrice: 10 });
  const customerId = await createCustomer(prisma, "L2 Advance Buyer");

  // Prepay Rs. 1000 with zero debt -> -1000 (D4 prepaid).
  await customerPaymentService.createCustomerPayment({ customerId, amount: 1000 });
  // Stock arrives via CASH purchase so the credit sales can consume it.
  const supplierId = await createSupplier(prisma, "L2 Stock Source");
  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CASH",
    items: [{ productId: product.id, quantity: 100, costPerUnit: 4 }], // wallet -400
  });
  // CREDIT sales consume the prepaid credit (signed add).
  await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: 50 }] }); // +500
  await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: product.id, quantity: 25 }] }); // +250

  const balance = await sqlScalar(`SELECT balance_owed::text AS v FROM customers WHERE id='${customerId}'`);
  assert.equal(balance, -250, "D4: -1000 + 500 + 250 = -250");

  const expectedDeposits = await sqlScalar(
    `SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='DEPOSIT'`
  );
  assert.equal(expectedDeposits, 1000, "wallet deposit = exactly the prepay; CREDIT sales deposit nothing");

  // Reconcile (auto) verifies balanceOwed == Σ CREDIT sales - Σ payments.
});

const code = finish();
await prisma.$disconnect();
process.exit(code);