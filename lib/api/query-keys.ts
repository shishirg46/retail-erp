// Query key factory (D22.2). One key shape per server resource so mutations
// can invalidate exactly the dependent lists they change — a sale refresh
// refreshes stock, sales list, and reports.

import type { ReportRange } from "@/modules/reports/report.types";

export const queryKeys = {
  products: {
    all: ["products"] as const,
    list: (search?: string, category?: string) =>
      [...queryKeys.products.all, { search, category }] as const,
    detail: (id: string) => [...queryKeys.products.all, id] as const,
  },
  sales: {
    all: ["sales"] as const,
    list: (paymentType?: string, next?: string) =>
      [...queryKeys.sales.all, { paymentType, next }] as const,
    detail: (id: string) => [...queryKeys.sales.all, id] as const,
  },
  reports: {
    all: ["reports"] as const,
    sales: (range: ReportRange) => [...queryKeys.reports.all, "sales", range] as const,
    wallet: (range: ReportRange) => [...queryKeys.reports.all, "wallet", range] as const,
  },
  customers: {
    all: ["customers"] as const,
    list: (search?: string) => [...queryKeys.customers.all, { search }] as const,
    detail: (id: string) => [...queryKeys.customers.all, id] as const,
  },
} as const;
