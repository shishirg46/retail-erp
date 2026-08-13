// Shared database helpers for test suites that touch a real Postgres.
//
// The single rule every DB-touching suite depends on: that database must be
// the dedicated `erp_retail_test`, never the development `erp_retail` (or any
// other database). `resolveTestDbUrl` reads TEST_DATABASE_URL, refuses to
// continue otherwise, and the callers construct their Prisma clients from the
// returned URL. `truncateAll` gives a deterministic empty slate between
// scenarios, and `reconcile` independently re-derives the D3/D4/D6 ledger
// invariants from raw rows so every mutation scenario is cross-checked.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { toNumber } from "../../modules/reports/report.mapper";

// Refuse to run unless TEST_DATABASE_URL points at `erp_retail_test`.
// Throws (never touches any other DB and never exits the process) so Vitest
// reports the guard failure as a test error instead of a silent kill.
export function resolveTestDbUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;

  if (!raw) {
    throw new Error(
      "TEST_DATABASE_URL is not set — refusing to run. Set it to the dedicated erp_retail_test database."
    );
  }

  const url = raw.replace(/^"|"$/g, "");
  const dbName = new URL(url).pathname.replace(/^\//, "").split("?")[0];

  if (dbName !== "erp_retail_test") {
    throw new Error(
      `TEST_DATABASE_URL must point at erp_retail_test (got '${dbName}') — refusing to run against any other database.`
    );
  }

  return url;
}

// Construct a PrismaClient bound to the (guard-verified) test database.
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: resolveTestDbUrl() }),
  });
}

export const ALL_TABLES = [
  "wallet_transactions",
  "credit_payments",
  "sale_items",
  "sales",
  "stock_movements",
  "purchase_items",
  "purchases",
  "price_tiers",
  "products",
  "supplier_payments",
  "suppliers",
  "customers",
] as const;

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      wallet_transactions,
      credit_payments,
      sale_items,
      sales,
      stock_movements,
      purchase_items,
      purchases,
      price_tiers,
      products,
      supplier_payments,
      suppliers,
      customers
    CASCADE
  `);
}

// Count rows in every application table. Used to prove rollback left zero
// partial rows and that read-only report queries mutate nothing.
export async function tableCounts(prisma: PrismaClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ALL_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c FROM "${table}"`
    );
    counts[table] = rows[0].c;
  }
  return counts;
}

const EPSILON = 1e-6;
const close = (a: number, b: number): boolean => Math.abs(a - b) < EPSILON;

// Re-derive the D3/D4/D6 ledger invariants independent of the services and
// report the balance against the ledger of signed movements / credit /
// payments / purchases / wallet transactions.
//
//   D6  per product:        Product.stockQty == Σ StockMovement.qtyChange
//   D4  per customer:       balanceOwed    == Σ CREDIT sales − Σ payments (signed)
//   D3  per supplier:       balanceOwed    == Σ CREDIT purchases − Σ supplier payments
//   wallet:                 deposits == Σ(non-CREDIT sales) + Σ(customer payments)
//                           withdrawals == Σ(CASH purchases) + Σ(supplier payments)
//
// Returns a list of violation messages (empty when all invariants hold).
export async function reconcile(prisma: PrismaClient): Promise<string[]> {
  const failures: string[] = [];

  // D6 — stock ledger identity per product.
  const products = await prisma.product.findMany({
    include: { stockMovements: true },
  });
  for (const product of products) {
    const summed = product.stockMovements.reduce((s, m) => s + m.qtyChange, 0);
    if (!close(product.stockQty, summed)) {
      failures.push(
        `D6 product '${product.name}': stockQty=${product.stockQty} != Σmovements=${summed}`
      );
    }
  }

  // D4 — signed customer balance vs credit sales and payments.
  const customers = await prisma.customer.findMany({
    include: { sales: true, creditPayments: true },
  });
  for (const customer of customers) {
    const creditSales = customer.sales
      .filter((s) => s.paymentType === "CREDIT")
      .reduce((s, x) => s + toNumber(x.total), 0);
    const paid = customer.creditPayments.reduce((s, x) => s + toNumber(x.amount), 0);
    const expected = creditSales - paid;
    if (!close(toNumber(customer.balanceOwed), expected)) {
      failures.push(
        `D4 customer '${customer.name}': balanceOwed=${toNumber(customer.balanceOwed)} != ${expected}`
      );
    }
  }

  // D3 — supplier balance vs credit purchases and supplier payments.
  const suppliers = await prisma.supplier.findMany({
    include: { purchases: true, supplierPayments: true },
  });
  for (const supplier of suppliers) {
    const creditPurchases = supplier.purchases
      .filter((p) => p.paymentType === "CREDIT")
      .reduce((s, x) => s + toNumber(x.total), 0);
    const paid = supplier.supplierPayments.reduce((s, x) => s + toNumber(x.amount), 0);
    const expected = creditPurchases - paid;
    if (!close(toNumber(supplier.balanceOwed), expected)) {
      failures.push(
        `D3 supplier '${supplier.name}': balanceOwed=${toNumber(supplier.balanceOwed)} != ${expected}`
      );
    }
  }

  // Wallet — deposits/withdrawals must equal the ledger that generates them.
  const walletDeposits = await prisma.walletTransaction.findMany({
    where: { type: "DEPOSIT" },
  });
  const walletWithdrawals = await prisma.walletTransaction.findMany({
    where: { type: "WITHDRAWAL" },
  });
  const deposits = walletDeposits.reduce((s, x) => s + toNumber(x.amount), 0);
  const withdrawals = walletWithdrawals.reduce((s, x) => s + toNumber(x.amount), 0);

  const saleDeposits = await prisma.sale.findMany({
    where: { paymentType: { not: "CREDIT" } },
  });
  const customerPayments = await prisma.creditPayment.findMany();
  const cashPurchases = await prisma.purchase.findMany({
    where: { paymentType: "CASH" },
  });
  const supplierPayments = await prisma.supplierPayment.findMany();

  const expectedDeposits =
    saleDeposits.reduce((s, x) => s + toNumber(x.total), 0) +
    customerPayments.reduce((s, x) => s + toNumber(x.amount), 0);
  const expectedWithdrawals =
    cashPurchases.reduce((s, x) => s + toNumber(x.total), 0) +
    supplierPayments.reduce((s, x) => s + toNumber(x.amount), 0);

  if (!close(deposits, expectedDeposits)) {
    failures.push(
      `wallet deposits=${deposits} != Σ(non-CREDIT sales)+Σ(customer payments)=${expectedDeposits}`
    );
  }
  if (!close(withdrawals, expectedWithdrawals)) {
    failures.push(
      `wallet withdrawals=${withdrawals} != Σ(CASH purchases)+Σ(supplier payments)=${expectedWithdrawals}`
    );
  }

  return failures;
}