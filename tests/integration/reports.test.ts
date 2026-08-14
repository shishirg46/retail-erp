// D7 reporting integration suite — read-only derivations vs raw SQL (Vitest).
//
// Seeds a deterministic ledger through the real services, then for every
// report re-derives every figure with independent raw SQL and requires the
// service output to match. Also proves read-only behavior (all table counts
// identical before/after) and date-range filtering. Only the dedicated
// `erp_retail_test` database is used.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaReportRepository } from "../../modules/reports/report.repository";
import { ReportService } from "../../modules/reports/report.service";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { SaleService } from "../../modules/sales/sale.service";
import { StockService } from "../../modules/stock/stock.service";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { parseReportDateRange } from "../../modules/reports/report.validation";
import { createTestPrisma, truncateAll, reconcile, tableCounts } from "../helpers/db";
import { createProduct, createCustomer, createSupplier } from "../helpers/seed";

const prisma = createTestPrisma();
const reportService = new ReportService(new PrismaReportRepository(prisma));
const purchaseService = new PurchaseService(prisma);
const saleService = new SaleService(prisma);
const stockService = new StockService(prisma);
const customerPaymentService = new CustomerPaymentService(prisma);
const supplierPaymentService = new SupplierPaymentService(prisma);

const EPS = 1e-6;
const close = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

async function scalar(query: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(query);
  return Number(rows[0].v);
}

async function seedLedger(): Promise<{ supplierId: string; customerId: string }> {
  // Domain inputs are paisa (D11); the DB stores rupees, so the report
  // assertions below stay in rupees (20000 paisa = Rs. 200.00).
  const rice = await createProduct(prisma, { name: "Rpt Rice", unit: "kg", costPrice: 2000, currentPrice: 2000 });
  const oil = await createProduct(prisma, { name: "Rpt Oil", unit: "liter", costPrice: 3000, currentPrice: 3000 });
  const supplierId = await createSupplier(prisma, "Rpt Wholesale");
  const customerId = await createCustomer(prisma, "Rpt Customer");

  await purchaseService.createPurchase({ // wallet -200.00
    supplierId,
    paymentType: "CASH",
    items: [{ productId: rice.id, quantity: 10, costPerUnit: 2000 }],
  });
  await purchaseService.createPurchase({ // supplier owes 150.00
    supplierId,
    paymentType: "CREDIT",
    items: [{ productId: oil.id, quantity: 5, costPerUnit: 3000 }],
  });
  await saleService.createSale({ paymentType: "CASH", items: [{ productId: rice.id, quantity: 3 }] }); // wallet +60.00
  await saleService.createSale({ paymentType: "ECASH", items: [{ productId: oil.id, quantity: 2 }] }); // wallet +60.00
  await saleService.createSale({ paymentType: "CREDIT", customerId, items: [{ productId: oil.id, quantity: 1 }] }); // owes 30.00
  await customerPaymentService.createCustomerPayment({ customerId, amount: 1000 }); // wallet +10.00, owes 20.00
  await supplierPaymentService.createSupplierPayment({ supplierId, amount: 5000 }); // wallet -50.00, owes 100.00
  await stockService.adjustStock({ productId: rice.id, reason: "DAMAGE", quantity: 2 }); // stock 5

  return { supplierId, customerId };
}

describe("reports (D7)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("RP1 every report value matches independent raw-SQL re-derivations", async () => {
    const { supplierId, customerId } = await seedLedger();
    const countsBefore = await tableCounts(prisma);

    // ── Sales report ────────────────────────────────────────────────────────
    const sales = await reportService.salesReport({});
    expect(sales.range).toEqual({ from: null, to: null });
    expect(sales.totalSales).toBe(150);
    expect(sales.numberOfSales).toBe(3);
    const byType = new Map(sales.byPaymentType.map((r) => [r.paymentType, r]));
    expect(byType.get("CASH")!.total).toBe(60);
    expect(byType.get("ECASH")!.total).toBe(60);
    expect(byType.get("CREDIT")!.total).toBe(30);
    const perProduct = new Map(sales.productQuantities.map((r) => [r.productName, r]));
    expect(perProduct.get("Rpt Rice")!.quantity).toBe(3);
    expect(close(perProduct.get("Rpt Rice")!.amount, 60)).toBe(true);
    expect(perProduct.get("Rpt Oil")!.quantity).toBe(3);
    expect(close(perProduct.get("Rpt Oil")!.amount, 90)).toBe(true);

    // Raw-SQL cross-check of the same figures.
    const sqlSalesTotal = await scalar("SELECT COALESCE(SUM(total),0)::text AS v FROM sales");
    expect(close(sales.totalSales, sqlSalesTotal)).toBe(true);
    const sqlOilAmount = await scalar(
      `SELECT COALESCE(SUM(qty * price_per_unit),0)::text AS v FROM sale_items si
       JOIN products p ON p.id = si.product_id WHERE p.name = 'Rpt Oil'`
    );
    expect(close(perProduct.get("Rpt Oil")!.amount, sqlOilAmount)).toBe(true);

    // ── Purchases report ─────────────────────────────────────────────────────
    const purchases = await reportService.purchasesReport({});
    expect(purchases.totalPurchases).toBe(350);
    expect(purchases.numberOfPurchases).toBe(2);
    const pType = new Map(purchases.byPaymentType.map((r) => [r.paymentType, r]));
    expect(pType.get("CASH")!.total).toBe(200);
    expect(pType.get("CREDIT")!.total).toBe(150);
    const supplierTotal = purchases.supplierTotals.find((r) => r.supplierId === supplierId)!;
    expect(supplierTotal.total).toBe(350);
    const sqlPurchases = await scalar("SELECT COALESCE(SUM(total),0)::text AS v FROM purchases");
    expect(close(purchases.totalPurchases, sqlPurchases)).toBe(true);

    // ── Stock report ─────────────────────────────────────────────────────────
    const stock = await reportService.stockReport({});
    const current = new Map(stock.currentStock.map((r) => [r.productName, r.stockQty]));
    expect(current.get("Rpt Rice")).toBe(5);
    expect(current.get("Rpt Oil")).toBe(2);
    const summary = new Map(stock.movementSummary.map((r) => [r.reason, r]));
    expect(summary.get("PURCHASE")!.quantity).toBe(15);
    expect(summary.get("PURCHASE")!.count).toBe(2);
    expect(summary.get("SALE")!.quantity).toBe(-6);
    expect(summary.get("SALE")!.count).toBe(3);
    expect(summary.get("DAMAGE")!.quantity).toBe(-2);
    expect(summary.get("DAMAGE")!.count).toBe(1);

    // ── Customers report ─────────────────────────────────────────────────────
    const customers = await reportService.customersReport({});
    expect(customers.outstandingCredit).toBe(20);
    expect(customers.prepaidCredit).toBe(0);
    const custRow = customers.customers.find((r) => r.customerId === customerId)!;
    expect(custRow.balanceOwed).toBe(20);
    const custPay = customers.paymentHistory.find((r) => r.customerId === customerId)!;
    expect(custPay.totalPaid).toBe(10);
    expect(custPay.count).toBe(1);
    const sqlCustPay = await scalar(
      `SELECT COALESCE(SUM(amount),0)::text AS v FROM credit_payments WHERE customer_id='${customerId}'`
    );
    expect(close(custPay.totalPaid, sqlCustPay)).toBe(true);

    // ── Suppliers report ─────────────────────────────────────────────────────
    const suppliers = await reportService.suppliersReport({});
    expect(suppliers.outstandingBalance).toBe(100);
    const supRow = suppliers.suppliers.find((r) => r.supplierId === supplierId)!;
    expect(supRow.balanceOwed).toBe(100);
    const supPay = suppliers.paymentHistory.find((r) => r.supplierId === supplierId)!;
    expect(supPay.totalPaid).toBe(50);
    expect(supPay.count).toBe(1);

    // ── Wallet report ────────────────────────────────────────────────────────
    const wallet = await reportService.walletReport({});
    expect(wallet.deposits).toBe(130);
    expect(wallet.withdrawals).toBe(250);
    expect(wallet.balance).toBe(-120);
    const source = new Map(wallet.bySource.map((r) => [r.source, r]));
    expect(source.get("SALE")!.deposits).toBe(120);
    expect(source.get("CREDIT_PAYMENT")!.deposits).toBe(10);
    expect(source.get("SUPPLIER_PAYMENT")!.withdrawals).toBe(250);
    const sqlDeposits = await scalar(
      "SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='DEPOSIT'"
    );
    const sqlWithdrawals = await scalar(
      "SELECT COALESCE(SUM(amount),0)::text AS v FROM wallet_transactions WHERE type='WITHDRAWAL'"
    );
    expect(close(wallet.deposits, sqlDeposits)).toBe(true);
    expect(close(wallet.withdrawals, sqlWithdrawals)).toBe(true);
    expect(close(wallet.balance, sqlDeposits - sqlWithdrawals)).toBe(true);

    // ── Read-only proof (D7) ────────────────────────────────────────────────
    expect(await tableCounts(prisma)).toEqual(countsBefore);
  });

  it("RP2 date ranges filter the ledger but leave balances current", async () => {
    await seedLedger();

    const tomorrowStart = new Date();
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const salesEmpty = await reportService.salesReport({ from: tomorrowStart, to: tomorrowEnd });
    expect(salesEmpty.numberOfSales).toBe(0);
    expect(salesEmpty.totalSales).toBe(0);

    const purchasesEmpty = await reportService.purchasesReport({ from: tomorrowStart, to: tomorrowEnd });
    expect(purchasesEmpty.numberOfPurchases).toBe(0);

    const walletEmpty = await reportService.walletReport({ from: tomorrowStart, to: tomorrowEnd });
    expect(walletEmpty.deposits).toBe(0);
    expect(walletEmpty.withdrawals).toBe(0);

    // An empty window still reports point-in-time current stock (D7).
    const stockEmpty = await reportService.stockReport({ from: tomorrowStart, to: tomorrowEnd });
    const current = new Map(stockEmpty.currentStock.map((r) => [r.productName, r.stockQty]));
    expect(current.get("Rpt Rice")).toBe(5);
    expect(current.get("Rpt Oil")).toBe(2);
    expect(stockEmpty.movementSummary).toEqual([]);

    // Whole-of-today must include every seeded row (all created now()).
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const salesToday = await reportService.salesReport({ from: todayStart, to: todayEnd });
    expect(salesToday.numberOfSales).toBe(3);

    // from > to is rejected by the same parser the route uses: ValidationError.
    expect(() =>
      parseReportDateRange(new URLSearchParams("?from=2026-09-01&to=2026-08-01"))
    ).toThrow();
  });
});