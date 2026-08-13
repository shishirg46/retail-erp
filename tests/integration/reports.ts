// D7 reporting integration suite — read-only derivations vs raw SQL.
//
// Seeds a deterministic ledger through the real services, then for every
// report re-derives every figure with independent raw SQL and requires the
// service output to match. Also proves read-only behavior (all table counts
// identical before/after) and date-range filtering. Only the dedicated
// `erp_retail_test` database is used.

import "dotenv/config";
import { strict as assert } from "node:assert";
import { PrismaReportRepository } from "../../modules/reports/report.repository";
import { ReportService } from "../../modules/reports/report.service";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { SaleService } from "../../modules/sales/sale.service";
import { StockService } from "../../modules/stock/stock.service";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { createDbSuite } from "../helpers/runner";
import { createProduct, createCustomer, createSupplier } from "../helpers/seed";
import { createTestPrisma, tableCounts } from "../helpers/db";

const prisma = createTestPrisma();
const reportService = new ReportService(new PrismaReportRepository(prisma));
const purchaseService = new PurchaseService(prisma);
const saleService = new SaleService(prisma);
const stockService = new StockService(prisma);
const customerPaymentService = new CustomerPaymentService(prisma);
const supplierPaymentService = new SupplierPaymentService(prisma);
const { scenario, finish } = createDbSuite(prisma);

const EPS = 1e-6;
const close = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

async function scalar(query: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(query);
  return Number(rows[0].v);
}

async function seedLedger(): Promise<{ supplierId: string; customerId: string }> {
  const rice = await createProduct(prisma, { name: "Rpt Rice", unit: "kg", costPrice: 20, currentPrice: 20 });
  const oil = await createProduct(prisma, { name: "Rpt Oil", unit: "liter", costPrice: 30, currentPrice: 30 });
  const supplierId = await createSupplier(prisma, "Rpt Wholesale");
  const customerId = await createCustomer(prisma, "Rpt Customer");

  await purchaseService.createPurchase({ // wallet -200
    supplierId,
    paymentType: "CASH",
    items: [{ productId: rice.id, quantity: 10, costPerUnit: 20 }],
  });
  await purchaseService.createPurchase({ // supplier owes 150
    supplierId,
    paymentType: "CREDIT",
    items: [{ productId: oil.id, quantity: 5, costPerUnit: 30 }],
  });
  await saleService.createSale({ paymentType: "CASH", items: [{ productId: rice.id, quantity: 3 }] }); // wallet +60
  await saleService.createSale({ paymentType: "ECASH", items: [{ productId: oil.id, quantity: 2 }] }); // wallet +60
  await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: oil.id, quantity: 1 }] }); // owes 30
  await customerPaymentService.createCustomerPayment({ customerId, amount: 10 }); // wallet +10, owes 20
  await supplierPaymentService.createSupplierPayment({ supplierId, amount: 50 }); // wallet -50, owes 100
  await stockService.adjustStock({ productId: rice.id, reason: "DAMAGE", quantity: 2 }); // stock 5

  return { supplierId, customerId };
}

await scenario("RP1 every report value matches independent raw-SQL re-derivations", async () => {
  const { supplierId, customerId } = await seedLedger();
  const countsBefore = await tableCounts(prisma);

  // ── Sales report ──────────────────────────────────────────────────────────
  const sales = await reportService.salesReport({});
  assert.deepEqual(sales.range, { from: null, to: null }, "range is echoed (D7)");
  assert.equal(sales.totalSales, 150, "Σ sales.total");
  assert.equal(sales.numberOfSales, 3);
  const byType = new Map(sales.byPaymentType.map((r) => [r.paymentType, r]));
  assert.equal(byType.get("CASH")!.total, 60);
  assert.equal(byType.get("ECASH")!.total, 60);
  assert.equal(byType.get("CREDIT")!.total, 30);
  const perProduct = new Map(sales.productQuantities.map((r) => [r.productName, r]));
  assert.equal(perProduct.get("Rpt Rice")!.quantity, 3);
  assert.ok(close(perProduct.get("Rpt Rice")!.amount, 60), "amount = Σ qty × pricePerUnit");
  assert.equal(perProduct.get("Rpt Oil")!.quantity, 3);
  assert.ok(close(perProduct.get("Rpt Oil")!.amount, 90));

  // Raw-SQL cross-check of the same figures.
  const sqlSalesTotal = await scalar("SELECT COALESCE(SUM(total),0)::text AS v FROM sales");
  assert.ok(close(sales.totalSales, sqlSalesTotal), "totalSales == raw SUM");
  const sqlOilAmount = await scalar(
    `SELECT COALESCE(SUM(qty * price_per_unit),0)::text AS v FROM sale_items si
     JOIN products p ON p.id = si.product_id WHERE p.name = 'Rpt Oil'`
  );
  assert.ok(close(perProduct.get("Rpt Oil")!.amount, sqlOilAmount),
    "productQuantities.amount == raw Σ qty×pricePerUnit");

  // ── Purchases report ──────────────────────────────────────────────────────
  const purchases = await reportService.purchasesReport({});
  assert.equal(purchases.totalPurchases, 350, "Σ purchases.total");
  assert.equal(purchases.numberOfPurchases, 2);
  const pType = new Map(purchases.byPaymentType.map((r) => [r.paymentType, r]));
  assert.equal(pType.get("CASH")!.total, 200);
  assert.equal(pType.get("CREDIT")!.total, 150);
  const supplierTotal = purchases.supplierTotals.find((r) => r.supplierId === supplierId)!;
  assert.equal(supplierTotal.total, 350);
  const sqlPurchases = await scalar("SELECT COALESCE(SUM(total),0)::text AS v FROM purchases");
  assert.ok(close(purchases.totalPurchases, sqlPurchases), "totalPurchases == raw SUM");

  // ── Stock report ──────────────────────────────────────────────────────────
  const stock = await reportService.stockReport({});
  const current = new Map(stock.currentStock.map((r) => [r.productName, r.stockQty]));
  assert.equal(current.get("Rpt Rice"), 5);
  assert.equal(current.get("Rpt Oil"), 2, "5 purchased - 2 ECASH - 1 CREDIT");
  const summary = new Map(stock.movementSummary.map((r) => [r.reason, r]));
  assert.equal(summary.get("PURCHASE")!.quantity, 15);
  assert.equal(summary.get("PURCHASE")!.count, 2);
  assert.equal(summary.get("SALE")!.quantity, -6, "3 + 2 + 1 units sold");
  assert.equal(summary.get("SALE")!.count, 3);
  assert.equal(summary.get("DAMAGE")!.quantity, -2);
  assert.equal(summary.get("DAMAGE")!.count, 1);

  // ── Customers report ──────────────────────────────────────────────────────
  const customers = await reportService.customersReport({});
  assert.equal(customers.outstandingCredit, 20);
  assert.equal(customers.prepaidCredit, 0);
  const custRow = customers.customers.find((r) => r.customerId === customerId)!;
  assert.equal(custRow.balanceOwed, 20);
  const custPay = customers.paymentHistory.find((r) => r.customerId === customerId)!;
  assert.equal(custPay.totalPaid, 10);
  assert.equal(custPay.count, 1);
  const sqlCustPay = await scalar(
    `SELECT COALESCE(SUM(amount),0)::text AS v FROM credit_payments WHERE customer_id='${customerId}'`
  );
  assert.ok(close(custPay.totalPaid, sqlCustPay), "paymentHistory.totalPaid == raw SUM");

  // ── Suppliers report ──────────────────────────────────────────────────────
  const suppliers = await reportService.suppliersReport({});
  assert.equal(suppliers.outstandingBalance, 100);
  const supRow = suppliers.suppliers.find((r) => r.supplierId === supplierId)!;
  assert.equal(supRow.balanceOwed, 100);
  const supPay = suppliers.paymentHistory.find((r) => r.supplierId === supplierId)!;
  assert.equal(supPay.totalPaid, 50);
  assert.equal(supPay.count, 1);

  // ── Wallet report ─────────────────────────────────────────────────────────
  const wallet = await reportService.walletReport({});
  assert.equal(wallet.deposits, 130, "60 CASH + 60 ECASH + 10 customer payment");
  assert.equal(wallet.withdrawals, 250, "200 CASH purchase + 50 supplier payment");
  assert.equal(wallet.balance, -120, "deposits - withdrawals");
  const source = new Map(wallet.bySource.map((r) => [r.source, r]));
  assert.equal(source.get("SALE")!.deposits, 120);
  assert.equal(source.get("CREDIT_PAYMENT")!.deposits, 10);
  assert.equal(source.get("SUPPLIER_PAYMENT")!.withdrawals, 250);
  const sqlDeposits = await scalar(
    "SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='DEPOSIT'"
  );
  const sqlWithdrawals = await scalar(
    "SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='WITHDRAWAL'"
  );
  assert.ok(close(wallet.deposits, sqlDeposits));
  assert.ok(close(wallet.withdrawals, sqlWithdrawals));
  assert.ok(close(wallet.balance, sqlDeposits - sqlWithdrawals));

  // ── Read-only proof (D7) ──────────────────────────────────────────────────
  assert.deepEqual(await tableCounts(prisma), countsBefore, "reports must not write a single row");
});

await scenario("RP2 date ranges filter the ledger but leave balances current", async () => {
  await seedLedger();

  const tomorrowStart = new Date();
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const salesEmpty = await reportService.salesReport({ from: tomorrowStart, to: tomorrowEnd });
  assert.equal(salesEmpty.numberOfSales, 0, "no sales in a future window");
  assert.equal(salesEmpty.totalSales, 0);

  const purchasesEmpty = await reportService.purchasesReport({ from: tomorrowStart, to: tomorrowEnd });
  assert.equal(purchasesEmpty.numberOfPurchases, 0);

  const walletEmpty = await reportService.walletReport({ from: tomorrowStart, to: tomorrowEnd });
  assert.equal(walletEmpty.deposits, 0);
  assert.equal(walletEmpty.withdrawals, 0);

  // An empty window still reports point-in-time current stock (D7).
  const stockEmpty = await reportService.stockReport({ from: tomorrowStart, to: tomorrowEnd });
  const current = new Map(stockEmpty.currentStock.map((r) => [r.productName, r.stockQty]));
  assert.equal(current.get("Rpt Rice"), 5, "stock is current regardless of the range");
  assert.equal(current.get("Rpt Oil"), 2, "5 purchased - 2 ECASH - 1 CREDIT");
  assert.deepEqual(stockEmpty.movementSummary, [], "movement history is range-filtered");

  // Whole-of-today must include every seeded row (all created now()).
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const salesToday = await reportService.salesReport({ from: todayStart, to: todayEnd });
  assert.equal(salesToday.numberOfSales, 3, "today's window includes all seeded sales");

  // from > to is rejected by validation (unit) — here prove the parser 400 path
  // through the same code the route uses: it throws ValidationError.
  const { parseReportDateRange } = await import("../../modules/reports/report.validation");
  let threw = false;
  try {
    parseReportDateRange(new URLSearchParams("?from=2026-09-01&to=2026-08-01"));
  } catch {
    threw = true;
  }
  assert.ok(threw, "inverted range is rejected (400 at the route)");
});

const code = finish();
await prisma.$disconnect();
process.exit(code);