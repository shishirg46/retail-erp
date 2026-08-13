import type {
  CustomersReport,
  PurchasesReport,
  ReportDateRange,
  ReportRepository,
  SalesReport,
  StockReport,
  SuppliersReport,
  WalletReport,
} from "./report.types";

// Read-only pass-through; every report is derived at request time from the
// transactional tables (D7). The repository never creates or mutates records.
export class ReportService {
  constructor(private readonly repository: ReportRepository) {}

  salesReport(range: ReportDateRange): Promise<SalesReport> {
    return this.repository.salesReport(range);
  }

  purchasesReport(range: ReportDateRange): Promise<PurchasesReport> {
    return this.repository.purchasesReport(range);
  }

  stockReport(range: ReportDateRange): Promise<StockReport> {
    return this.repository.stockReport(range);
  }

  customersReport(range: ReportDateRange): Promise<CustomersReport> {
    return this.repository.customersReport(range);
  }

  suppliersReport(range: ReportDateRange): Promise<SuppliersReport> {
    return this.repository.suppliersReport(range);
  }

  walletReport(range: ReportDateRange): Promise<WalletReport> {
    return this.repository.walletReport(range);
  }
}