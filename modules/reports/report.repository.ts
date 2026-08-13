import { prisma } from "../../lib/prisma";
import { toNumber } from "./report.mapper";

import type {
  CustomerPaymentHistoryRow,
  CurrentStockRow,
  CustomerBalanceRow,
  MovementSummaryRow,
  ProductQuantityRow,
  PurchasesByPaymentTypeRow,
  PurchasesReport,
  ReportDateRange,
  ReportRange,
  ReportRepository,
  SalesByPaymentTypeRow,
  SalesReport,
  StockReport,
  SuppliersReport,
  SupplierBalanceRow,
  SupplierPaymentHistoryRow,
  SupplierTotalRow,
  CustomersReport,
  WalletReport,
  WalletSourceRow,
  PaymentType,
  PurchasePaymentType,
  StockReason,
  WalletTxnSource,
} from "./report.types";

// Inclusive date window from <= date <= to; empty object = no bound.
function dateFilter(range: ReportDateRange): { gte?: Date; lte?: Date } | undefined {
  const where: { gte?: Date; lte?: Date } = {};
  if (range.from !== undefined) where.gte = range.from;
  if (range.to !== undefined) where.lte = range.to;
  return Object.keys(where).length === 0 ? undefined : where;
}

function rangeEcho(range: ReportDateRange): ReportRange {
  return {
    from: range.from === undefined ? null : range.from.toISOString(),
    to: range.to === undefined ? null : range.to.toISOString(),
  };
}

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly db: typeof prisma) {}

  async salesReport(range: ReportDateRange): Promise<SalesReport> {
    const where = { date: dateFilter(range) };

    const [aggregate, byPaymentType, items, products] = await Promise.all([
      this.db.sale.aggregate({
        where,
        _sum: { total: true },
        _count: true,
      }),
      this.db.sale.groupBy({
        by: ["paymentType"],
        where,
        _sum: { total: true },
        _count: true,
      }),
      this.db.saleItem.findMany({
        where: { sale: { date: dateFilter(range) } },
        select: {
          productId: true,
          qty: true,
          pricePerUnit: true,
          product: { select: { name: true } },
        },
      }),
      this.db.product.findMany({ select: { id: true, name: true } }),
    ]);

    const productName = new Map(products.map((p) => [p.id, p.name]));

    const perProduct = new Map<string, ProductQuantityRow>();
    for (const item of items) {
      const entry =
        perProduct.get(item.productId) ?? {
          productId: item.productId,
          productName: productName.get(item.productId) ?? "unknown",
          quantity: 0,
          amount: 0,
        };
      entry.quantity += item.qty;
      entry.amount += toNumber(item.pricePerUnit) * item.qty;
      perProduct.set(item.productId, entry);
    }

    return {
      range: rangeEcho(range),
      totalSales: toNumber(aggregate._sum.total),
      numberOfSales: aggregate._count,
      byPaymentType: byPaymentType
        .map(
          (row): SalesByPaymentTypeRow => ({
            paymentType: row.paymentType as PaymentType,
            count: row._count,
            total: toNumber(row._sum.total),
          })
        )
        .sort((a, b) => b.total - a.total),
      productQuantities: [...perProduct.values()].sort((a, b) =>
        a.productName.localeCompare(b.productName)
      ),
    };
  }

  async purchasesReport(range: ReportDateRange): Promise<PurchasesReport> {
    const where = { date: dateFilter(range) };

    const [aggregate, byPaymentType, bySupplier, suppliers] = await Promise.all([
      this.db.purchase.aggregate({ where, _sum: { total: true }, _count: true }),
      this.db.purchase.groupBy({
        by: ["paymentType"],
        where,
        _sum: { total: true },
        _count: true,
      }),
      this.db.purchase.groupBy({
        by: ["supplierId"],
        where,
        _sum: { total: true },
      }),
      this.db.supplier.findMany({ select: { id: true, name: true } }),
    ]);

    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

    const supplierTotals: SupplierTotalRow[] = bySupplier
      .map((row) => ({
        supplierId: row.supplierId,
        supplierName: supplierName.get(row.supplierId) ?? "unknown",
        total: toNumber(row._sum.total),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      range: rangeEcho(range),
      totalPurchases: toNumber(aggregate._sum.total),
      numberOfPurchases: aggregate._count,
      byPaymentType: byPaymentType
        .map(
          (row): PurchasesByPaymentTypeRow => ({
            paymentType: row.paymentType as PurchasePaymentType,
            count: row._count,
            total: toNumber(row._sum.total),
          })
        )
        .sort((a, b) => b.total - a.total),
      supplierTotals,
    };
  }

  async stockReport(range: ReportDateRange): Promise<StockReport> {
    const [currentStock, summary] = await Promise.all([
      this.db.product.findMany({
        select: { id: true, name: true, stockQty: true },
      }),
      this.db.stockMovement.groupBy({
        by: ["reason"],
        where: { date: dateFilter(range) },
        _sum: { qtyChange: true },
        _count: true,
      }),
    ]);

    const currentStockRows: CurrentStockRow[] = currentStock
      .map((row) => ({
        productId: row.id,
        productName: row.name,
        stockQty: row.stockQty,
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName));

    const movementSummary: MovementSummaryRow[] = summary
      .map((row) => ({
        reason: row.reason as StockReason,
        quantity: toNumber(row._sum.qtyChange),
        count: row._count,
      }))
      .sort((a, b) => b.quantity - a.quantity);

    return {
      range: rangeEcho(range),
      currentStock: currentStockRows,
      movementSummary,
    };
  }

  async customersReport(range: ReportDateRange): Promise<CustomersReport> {
    const [customers, paymentRows] = await Promise.all([
      this.db.customer.findMany({ select: { id: true, name: true, balanceOwed: true } }),
      this.db.creditPayment.groupBy({
        by: ["customerId"],
        where: { date: dateFilter(range) },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    let outstandingCredit = 0;
    let prepaidCredit = 0;

    const balanceRows: CustomerBalanceRow[] = customers
      .map((row) => {
        const balance = toNumber(row.balanceOwed);
        if (balance > 0) outstandingCredit += balance;
        if (balance < 0) prepaidCredit += -balance;
        return { customerId: row.id, customerName: row.name, balanceOwed: balance };
      })
      .sort((a, b) => a.customerName.localeCompare(b.customerName));

    const customerName = new Map(customers.map((c) => [c.id, c.name]));

    const paymentHistory: CustomerPaymentHistoryRow[] = paymentRows
      .map((row) => ({
        customerId: row.customerId,
        customerName: customerName.get(row.customerId) ?? "unknown",
        totalPaid: toNumber(row._sum.amount),
        count: row._count,
      }))
      .sort((a, b) => b.totalPaid - a.totalPaid);

    return {
      range: rangeEcho(range),
      outstandingCredit,
      prepaidCredit,
      customers: balanceRows,
      paymentHistory,
    };
  }

  async suppliersReport(range: ReportDateRange): Promise<SuppliersReport> {
    const [suppliers, paymentRows] = await Promise.all([
      this.db.supplier.findMany({ select: { id: true, name: true, balanceOwed: true } }),
      this.db.supplierPayment.groupBy({
        by: ["supplierId"],
        where: { date: dateFilter(range) },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    let outstandingBalance = 0;

    const balanceRows: SupplierBalanceRow[] = suppliers
      .map((row) => {
        const balance = toNumber(row.balanceOwed);
        if (balance > 0) outstandingBalance += balance;
        return { supplierId: row.id, supplierName: row.name, balanceOwed: balance };
      })
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName));

    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

    const paymentHistory: SupplierPaymentHistoryRow[] = paymentRows
      .map((row) => ({
        supplierId: row.supplierId,
        supplierName: supplierName.get(row.supplierId) ?? "unknown",
        totalPaid: toNumber(row._sum.amount),
        count: row._count,
      }))
      .sort((a, b) => b.totalPaid - a.totalPaid);

    return {
      range: rangeEcho(range),
      outstandingBalance,
      suppliers: balanceRows,
      paymentHistory,
    };
  }

  async walletReport(range: ReportDateRange): Promise<WalletReport> {
    const groups = await this.db.walletTransaction.groupBy({
      by: ["source", "type"],
      where: { date: dateFilter(range) },
      _sum: { amount: true },
      _count: true,
    });

    let deposits = 0;
    let withdrawals = 0;

    const perSource = new Map<string, WalletSourceRow>();
    for (const row of groups) {
      const amount = toNumber(row._sum.amount);
      if (row.type === "DEPOSIT") deposits += amount;
      else withdrawals += amount;

      const key = row.source as WalletTxnSource;
      const entry =
        perSource.get(key) ?? { source: key, deposits: 0, withdrawals: 0, count: 0 };
      entry.count += row._count;
      if (row.type === "DEPOSIT") entry.deposits += amount;
      else entry.withdrawals += amount;
      perSource.set(key, entry);
    }

    return {
      range: rangeEcho(range),
      deposits,
      withdrawals,
      balance: deposits - withdrawals,
      bySource: [...perSource.values()].sort((a, b) => a.source.localeCompare(b.source)),
    };
  }
}