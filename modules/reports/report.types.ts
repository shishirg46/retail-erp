// Money in these report payloads is RUPEES (number): the report payload is the
// output boundary, so paisa math happens inside the repository and converts to
// rupees exactly once when the payload is built (D11). Range instants echo in
// the shop timezone with the shop's offset (D10).
export type PaymentType = "CASH" | "ECASH" | "CREDIT";
export type PurchasePaymentType = "CASH" | "CREDIT";
export type StockReason = "PURCHASE" | "SALE" | "DAMAGE" | "CORRECTION" | "OPENING";
export type WalletTxnSource =
  | "SALE"
  | "CREDIT_PAYMENT"
  | "SUPPLIER_PAYMENT"
  | "OWNER_WITHDRAWAL"
  | "EXPENSE"
  | "BANK_DEPOSIT"
  | "OTHER";

// Inclusive date window: from <= date <= to. Absent bounds = unbounded (full history).
export interface ReportDateRange {
  from?: Date;
  to?: Date;
}

// Echoed back on every report so the exact window is unambiguous.
export interface ReportRange {
  from: string | null;
  to: string | null;
}

export interface SalesByPaymentTypeRow {
  paymentType: PaymentType;
  count: number;
  total: number;
}

// amount = Σ (qty × pricePerUnit). Carries the D1 ≤ 3 paisa per-sale drift;
// it is informational only — authoritative totals always come from sales.total.
export interface ProductQuantityRow {
  productId: string;
  productName: string;
  quantity: number;
  amount: number;
}

export interface SalesReport {
  range: ReportRange;
  totalSales: number;
  numberOfSales: number;
  byPaymentType: SalesByPaymentTypeRow[];
  productQuantities: ProductQuantityRow[];
}

export interface PurchasesByPaymentTypeRow {
  paymentType: PurchasePaymentType;
  count: number;
  total: number;
}

export interface SupplierTotalRow {
  supplierId: string;
  supplierName: string;
  total: number;
}

export interface PurchasesReport {
  range: ReportRange;
  totalPurchases: number;
  numberOfPurchases: number;
  byPaymentType: PurchasesByPaymentTypeRow[];
  supplierTotals: SupplierTotalRow[];
}

export interface CurrentStockRow {
  productId: string;
  productName: string;
  stockQty: number;
}

// quantity = Σ qty_change: PURCHASE ≥ 0, SALE/DAMAGE ≤ 0, CORRECTION ±.
export interface MovementSummaryRow {
  reason: StockReason;
  quantity: number;
  count: number;
}

export interface StockReport {
  range: ReportRange;
  currentStock: CurrentStockRow[];
  movementSummary: MovementSummaryRow[];
}

export interface CustomerBalanceRow {
  customerId: string;
  customerName: string;
  balanceOwed: number; // signed; negative = prepaid credit (D4)
}

export interface CustomerPaymentHistoryRow {
  customerId: string;
  customerName: string;
  totalPaid: number;
  count: number;
}

export interface CustomersReport {
  range: ReportRange;
  outstandingCredit: number;
  prepaidCredit: number; // positive number, sum of negative balances
  customers: CustomerBalanceRow[];
  paymentHistory: CustomerPaymentHistoryRow[];
}

export interface SupplierBalanceRow {
  supplierId: string;
  supplierName: string;
  balanceOwed: number; // what the shop owes; negative = shop prepaid the supplier
}

export interface SupplierPaymentHistoryRow {
  supplierId: string;
  supplierName: string;
  totalPaid: number;
  count: number;
}

export interface SuppliersReport {
  range: ReportRange;
  outstandingBalance: number;
  suppliers: SupplierBalanceRow[];
  paymentHistory: SupplierPaymentHistoryRow[];
}

export interface WalletSourceRow {
  source: WalletTxnSource;
  deposits: number;
  withdrawals: number;
  count: number;
}

export interface WalletReport {
  range: ReportRange;
  deposits: number;
  withdrawals: number;
  balance: number; // deposits − withdrawals within the reported range
  bySource: WalletSourceRow[];
}

export interface ReportRepository {
  salesReport(range: ReportDateRange): Promise<SalesReport>;
  purchasesReport(range: ReportDateRange): Promise<PurchasesReport>;
  stockReport(range: ReportDateRange): Promise<StockReport>;
  customersReport(range: ReportDateRange): Promise<CustomersReport>;
  suppliersReport(range: ReportDateRange): Promise<SuppliersReport>;
  walletReport(range: ReportDateRange): Promise<WalletReport>;
}