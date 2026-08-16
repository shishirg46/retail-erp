import { prisma } from "../../lib/prisma";
import { paisaFromDecimal, paisaToRupees, roundHalfUp } from "../../lib/money";
import { quantityFromDecimal, unitsToQuantity } from "../../lib/quantity";
import { formatShopLocal } from "../../lib/timezone";
import { listVoidedTargetIds } from "../voids/void.repository";

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

// Echo the window in the shop timezone with the shop's offset, so the day the
// report actually covers is unambiguous (D10). Absent bound = full history.
function rangeEcho(range: ReportDateRange): ReportRange {
  return {
    from: range.from === undefined ? null : formatShopLocal(range.from),
    to: range.to === undefined ? null : formatShopLocal(range.to),
  };
}

// IDs of every record of a type that has been voided. Reports are read-only
// derivations over ACTIVE activity: voided transactions (and their offsetting
// reversal records, which share the voided origin's FK) are excluded (D18.8).
export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly db: typeof prisma) {}

  async salesReport(range: ReportDateRange): Promise<SalesReport> {
    const voidedSaleIds = await listVoidedTargetIds(this.db, "SALE");
    const where = { date: dateFilter(range), id: { notIn: voidedSaleIds } };

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
        where: { sale: { date: dateFilter(range), id: { notIn: voidedSaleIds } } },
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

    // All money is summed in whole paisa (exact), converted once at payload
    // construction (D11). Quantities are summed in scaled units (exact
    // integers, D25.6) and converted to human units once at payload
    // construction. The per-product amount reconstructs what was charged from
    // the frozen pricePerUnit (paisa per human unit): qtyUnits × pricePerUnit
    // / 100, rounded half-up to whole paisa — a no-op for whole units, exactly
    // as before D25.
    const perProduct = new Map<string, { quantity: number; amountPaisa: number }>();
    for (const item of items) {
      const qtyUnits = quantityFromDecimal(item.qty);
      const entry =
        perProduct.get(item.productId) ?? { quantity: 0, amountPaisa: 0 };
      entry.quantity += qtyUnits;
      entry.amountPaisa += roundHalfUp(
        (qtyUnits * paisaFromDecimal(item.pricePerUnit)) / 100
      );
      perProduct.set(item.productId, entry);
    }

    const totalSalesPaisa = paisaFromDecimal(aggregate._sum.total);

    return {
      range: rangeEcho(range),
      totalSales: paisaToRupees(totalSalesPaisa),
      numberOfSales: aggregate._count,
      byPaymentType: byPaymentType
        .map(
          (row): SalesByPaymentTypeRow => ({
            paymentType: row.paymentType as PaymentType,
            count: row._count,
            total: paisaToRupees(paisaFromDecimal(row._sum.total)),
          })
        )
        .sort((a, b) => b.total - a.total),
      productQuantities: [...perProduct.entries()]
        .map(
          ([productId, entry]): ProductQuantityRow => ({
            productId,
            productName: productName.get(productId) ?? "unknown",
            quantity: unitsToQuantity(entry.quantity),
            amount: paisaToRupees(entry.amountPaisa),
          })
        )
        .sort((a, b) => a.productName.localeCompare(b.productName)),
    };
  }

  async purchasesReport(range: ReportDateRange): Promise<PurchasesReport> {
    const voidedPurchaseIds = await listVoidedTargetIds(this.db, "PURCHASE");
    const where = { date: dateFilter(range), id: { notIn: voidedPurchaseIds } };

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
        total: paisaToRupees(paisaFromDecimal(row._sum.total)),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      range: rangeEcho(range),
      totalPurchases: paisaToRupees(paisaFromDecimal(aggregate._sum.total)),
      numberOfPurchases: aggregate._count,
      byPaymentType: byPaymentType
        .map(
          (row): PurchasesByPaymentTypeRow => ({
            paymentType: row.paymentType as PurchasePaymentType,
            count: row._count,
            total: paisaToRupees(paisaFromDecimal(row._sum.total)),
          })
        )
        .sort((a, b) => b.total - a.total),
      supplierTotals,
    };
  }

  async stockReport(range: ReportDateRange): Promise<StockReport> {
    const [voidedMovementIds, voidedSaleIds, voidedPurchaseIds] =
      await Promise.all([
        listVoidedTargetIds(this.db, "STOCK_MOVEMENT"),
        listVoidedTargetIds(this.db, "SALE"),
        listVoidedTargetIds(this.db, "PURCHASE"),
      ]);

    const [currentStock, summary] = await Promise.all([
      this.db.product.findMany({
        select: { id: true, name: true, stockQty: true },
      }),
      // Exclude voided activity from the movement summary: reversal movements
      // carry reason VOID, directly-voided adjustments are excluded by id, and
      // movements belonging to voided sales/purchases are excluded by origin FK.
      this.db.stockMovement.groupBy({
        by: ["reason"],
        where: {
          date: dateFilter(range),
          reason: { not: "VOID" },
          id: { notIn: voidedMovementIds },
          AND: [
            { OR: [{ saleId: null }, { sale: { id: { notIn: voidedSaleIds } } }] },
            { OR: [{ purchaseId: null }, { purchase: { id: { notIn: voidedPurchaseIds } } }] },
          ],
        },
        _sum: { qtyChange: true },
        _count: true,
      }),
    ]);

    const currentStockRows: CurrentStockRow[] = currentStock
      .map((row) => ({
        productId: row.id,
        productName: row.name,
        stockQty: unitsToQuantity(quantityFromDecimal(row.stockQty)),
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName));

    const movementSummary: MovementSummaryRow[] = summary
      .map((row) => ({
        reason: row.reason as StockReason,
        quantity: unitsToQuantity(quantityFromDecimal(row._sum.qtyChange)),
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
    const voidedCreditPaymentIds = await listVoidedTargetIds(this.db, "CREDIT_PAYMENT");
    const [customers, paymentRows] = await Promise.all([
      this.db.customer.findMany({ select: { id: true, name: true, balanceOwed: true } }),
      this.db.creditPayment.groupBy({
        by: ["customerId"],
        where: { date: dateFilter(range), id: { notIn: voidedCreditPaymentIds } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    let outstandingCreditPaisa = 0;
    let prepaidCreditPaisa = 0;

    const balanceRows: CustomerBalanceRow[] = customers
      .map((row) => {
        const balancePaisa = paisaFromDecimal(row.balanceOwed);
        if (balancePaisa > 0) outstandingCreditPaisa += balancePaisa;
        if (balancePaisa < 0) prepaidCreditPaisa += -balancePaisa;
        return {
          customerId: row.id,
          customerName: row.name,
          balanceOwed: paisaToRupees(balancePaisa),
        };
      })
      .sort((a, b) => a.customerName.localeCompare(b.customerName));

    const customerName = new Map(customers.map((c) => [c.id, c.name]));

    const paymentHistory: CustomerPaymentHistoryRow[] = paymentRows
      .map((row) => ({
        customerId: row.customerId,
        customerName: customerName.get(row.customerId) ?? "unknown",
        totalPaid: paisaToRupees(paisaFromDecimal(row._sum.amount)),
        count: row._count,
      }))
      .sort((a, b) => b.totalPaid - a.totalPaid);

    return {
      range: rangeEcho(range),
      outstandingCredit: paisaToRupees(outstandingCreditPaisa),
      prepaidCredit: paisaToRupees(prepaidCreditPaisa),
      customers: balanceRows,
      paymentHistory,
    };
  }

  async suppliersReport(range: ReportDateRange): Promise<SuppliersReport> {
    const voidedSupplierPaymentIds = await listVoidedTargetIds(this.db, "SUPPLIER_PAYMENT");
    const [suppliers, paymentRows] = await Promise.all([
      this.db.supplier.findMany({ select: { id: true, name: true, balanceOwed: true } }),
      this.db.supplierPayment.groupBy({
        by: ["supplierId"],
        where: { date: dateFilter(range), id: { notIn: voidedSupplierPaymentIds } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    let outstandingBalancePaisa = 0;

    const balanceRows: SupplierBalanceRow[] = suppliers
      .map((row) => {
        const balancePaisa = paisaFromDecimal(row.balanceOwed);
        if (balancePaisa > 0) outstandingBalancePaisa += balancePaisa;
        return {
          supplierId: row.id,
          supplierName: row.name,
          balanceOwed: paisaToRupees(balancePaisa),
        };
      })
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName));

    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

    const paymentHistory: SupplierPaymentHistoryRow[] = paymentRows
      .map((row) => ({
        supplierId: row.supplierId,
        supplierName: supplierName.get(row.supplierId) ?? "unknown",
        totalPaid: paisaToRupees(paisaFromDecimal(row._sum.amount)),
        count: row._count,
      }))
      .sort((a, b) => b.totalPaid - a.totalPaid);

    return {
      range: rangeEcho(range),
      outstandingBalance: paisaToRupees(outstandingBalancePaisa),
      suppliers: balanceRows,
      paymentHistory,
    };
  }

  async walletReport(range: ReportDateRange): Promise<WalletReport> {
    const [voidedSaleIds, voidedPurchaseIds, voidedCreditPaymentIds, voidedSupplierPaymentIds] =
      await Promise.all([
        listVoidedTargetIds(this.db, "SALE"),
        listVoidedTargetIds(this.db, "PURCHASE"),
        listVoidedTargetIds(this.db, "CREDIT_PAYMENT"),
        listVoidedTargetIds(this.db, "SUPPLIER_PAYMENT"),
      ]);

    // Exclude wallet activity whose originating transaction is voided — both
    // the original entries and their VOID-source reversals carry the voided
    // origin's FK, so they are all dropped deterministically (D18.8).
    const groups = await this.db.walletTransaction.groupBy({
      by: ["source", "type"],
      where: {
        date: dateFilter(range),
        AND: [
          { OR: [{ saleId: null }, { sale: { id: { notIn: voidedSaleIds } } }] },
          { OR: [{ purchaseId: null }, { purchase: { id: { notIn: voidedPurchaseIds } } }] },
          { OR: [{ creditPaymentId: null }, { creditPayment: { id: { notIn: voidedCreditPaymentIds } } }] },
          { OR: [{ supplierPaymentId: null }, { supplierPayment: { id: { notIn: voidedSupplierPaymentIds } } }] },
        ],
      },
      _sum: { amount: true },
      _count: true,
    });

    let depositsPaisa = 0;
    let withdrawalsPaisa = 0;

    const perSource = new Map<string, WalletSourceRow>();
    for (const row of groups) {
      const amountPaisa = paisaFromDecimal(row._sum.amount);
      if (row.type === "DEPOSIT") depositsPaisa += amountPaisa;
      else withdrawalsPaisa += amountPaisa;

      const key = row.source as WalletTxnSource;
      const entry =
        perSource.get(key) ?? { source: key, deposits: 0, withdrawals: 0, count: 0 };
      entry.count += row._count;
      if (row.type === "DEPOSIT") entry.deposits += amountPaisa;
      else entry.withdrawals += amountPaisa;
      perSource.set(key, entry);
    }

    const bySource: WalletSourceRow[] = [...perSource.values()].map((row) => ({
      source: row.source,
      deposits: paisaToRupees(row.deposits),
      withdrawals: paisaToRupees(row.withdrawals),
      count: row.count,
    }));

    return {
      range: rangeEcho(range),
      deposits: paisaToRupees(depositsPaisa),
      withdrawals: paisaToRupees(withdrawalsPaisa),
      balance: paisaToRupees(depositsPaisa - withdrawalsPaisa),
      bySource: bySource.sort((a, b) => a.source.localeCompare(b.source)),
    };
  }
}
