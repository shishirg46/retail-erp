// Report → export document mapping (M20).
//
// Every D7 report is laid out as a deterministic, flat document: metadata rows
// (report name + the D10 range echo) followed by one table per report section.
// The table columns/rows are derived 1:1 from the report payload the report
// repository already computed — this module adds no aggregation and never
// touches the database, so the export can never drift from the report.

import type {
  CustomersReport,
  PurchasesReport,
  ReportRange,
  SalesReport,
  StockReport,
  SuppliersReport,
  WalletReport,
} from "../reports/report.types";

import type {
  AnyReport,
  ExportDocument,
  ExportMetadataRow,
  ExportTable,
  ReportName,
} from "./export.types";

// The range echo (D10) is the document header: which window the export covers,
// in the shop's own timezone with its offset. An absent bound renders empty.
function rangeMetadata(name: ReportName, range: ReportRange): ExportMetadataRow[] {
  return [
    { key: "Report", value: name },
    { key: "From", value: range.from },
    { key: "To", value: range.to },
  ];
}

function summaryTable(rows: [string, string | number][]): ExportTable {
  return {
    title: "Summary",
    columns: ["Key", "Value"],
    rows: rows.map(([key, value]) => [key, value]),
  };
}

function salesDocument(report: SalesReport): ExportDocument {
  return {
    metadata: rangeMetadata("sales", report.range),
    tables: [
      summaryTable([
        ["Total sales", report.totalSales],
        ["Number of sales", report.numberOfSales],
      ]),
      {
        title: "By payment type",
        columns: ["Payment type", "Count", "Total"],
        rows: report.byPaymentType.map((row) => [row.paymentType, row.count, row.total]),
      },
      {
        title: "Products sold",
        columns: ["Product ID", "Product name", "Quantity", "Amount"],
        rows: report.productQuantities.map((row) => [
          row.productId,
          row.productName,
          row.quantity,
          row.amount,
        ]),
      },
    ],
  };
}

function purchasesDocument(report: PurchasesReport): ExportDocument {
  return {
    metadata: rangeMetadata("purchases", report.range),
    tables: [
      summaryTable([
        ["Total purchases", report.totalPurchases],
        ["Number of purchases", report.numberOfPurchases],
      ]),
      {
        title: "By payment type",
        columns: ["Payment type", "Count", "Total"],
        rows: report.byPaymentType.map((row) => [row.paymentType, row.count, row.total]),
      },
      {
        title: "Suppliers",
        columns: ["Supplier ID", "Supplier name", "Total"],
        rows: report.supplierTotals.map((row) => [row.supplierId, row.supplierName, row.total]),
      },
    ],
  };
}

function stockDocument(report: StockReport): ExportDocument {
  return {
    metadata: rangeMetadata("stock", report.range),
    tables: [
      {
        title: "Current stock",
        columns: ["Product ID", "Product name", "Stock quantity"],
        rows: report.currentStock.map((row) => [row.productId, row.productName, row.stockQty]),
      },
      {
        title: "Movement summary",
        columns: ["Reason", "Quantity", "Count"],
        rows: report.movementSummary.map((row) => [row.reason, row.quantity, row.count]),
      },
    ],
  };
}

function customersDocument(report: CustomersReport): ExportDocument {
  return {
    metadata: rangeMetadata("customers", report.range),
    tables: [
      summaryTable([
        ["Outstanding credit", report.outstandingCredit],
        ["Prepaid credit", report.prepaidCredit],
      ]),
      {
        title: "Customers",
        columns: ["Customer ID", "Customer name", "Balance owed"],
        rows: report.customers.map((row) => [row.customerId, row.customerName, row.balanceOwed]),
      },
      {
        title: "Payment history",
        columns: ["Customer ID", "Customer name", "Total paid", "Count"],
        rows: report.paymentHistory.map((row) => [
          row.customerId,
          row.customerName,
          row.totalPaid,
          row.count,
        ]),
      },
    ],
  };
}

function suppliersDocument(report: SuppliersReport): ExportDocument {
  return {
    metadata: rangeMetadata("suppliers", report.range),
    tables: [
      summaryTable([["Outstanding balance", report.outstandingBalance]]),
      {
        title: "Suppliers",
        columns: ["Supplier ID", "Supplier name", "Balance owed"],
        rows: report.suppliers.map((row) => [row.supplierId, row.supplierName, row.balanceOwed]),
      },
      {
        title: "Payment history",
        columns: ["Supplier ID", "Supplier name", "Total paid", "Count"],
        rows: report.paymentHistory.map((row) => [
          row.supplierId,
          row.supplierName,
          row.totalPaid,
          row.count,
        ]),
      },
    ],
  };
}

function walletDocument(report: WalletReport): ExportDocument {
  return {
    metadata: rangeMetadata("wallet", report.range),
    tables: [
      summaryTable([
        ["Deposits", report.deposits],
        ["Withdrawals", report.withdrawals],
        ["Balance", report.balance],
      ]),
      {
        title: "By source",
        columns: ["Source", "Deposits", "Withdrawals", "Count"],
        rows: report.bySource.map((row) => [
          row.source,
          row.deposits,
          row.withdrawals,
          row.count,
        ]),
      },
    ],
  };
}

// Build the CSV document for a report. The switch keys off the report name the
// route already authorized, so a report name can never reach the wrong layout.
export function reportToDocument(name: ReportName, report: AnyReport): ExportDocument {
  switch (name) {
    case "sales":
      return salesDocument(report as SalesReport);
    case "purchases":
      return purchasesDocument(report as PurchasesReport);
    case "stock":
      return stockDocument(report as StockReport);
    case "customers":
      return customersDocument(report as CustomersReport);
    case "suppliers":
      return suppliersDocument(report as SuppliersReport);
    case "wallet":
      return walletDocument(report as WalletReport);
  }
}

// Download filename, e.g. `sales-report.csv` / `sales-report.json`.
export function exportFilename(name: ReportName, format: "csv" | "json"): string {
  return `${name}-report.${format}`;
}
