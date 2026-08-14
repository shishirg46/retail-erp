// Read-only pre-migration validation for F-05 (DB CHECK constraints).
//
// Before the F-05 migration is applied, prove that no existing row in the
// development and/or test database would violate any of the 17 proposed CHECK
// constraints, and that the D6 stock-ledger invariant still holds per product.
// It performs NO writes. Exits non-zero listing every offending row so the
// migration can be stopped before it fails.
//
// Usage:
//   node scripts/validate-f05-preconditions.mjs            # both dev + test
//   node scripts/validate-f05-preconditions.mjs dev        # dev only
//   node scripts/validate-f05-preconditions.mjs test       # test only

import { execFileSync } from "node:child_process";

const TARGET = process.argv[2] ?? "all";

const DEV_URL = (process.env.DATABASE_URL ?? "").replace(/\?schema=.*$/, "");
const TEST_URL = (process.env.TEST_DATABASE_URL ?? "").replace(/\?schema=.*$/, "");

// Each entry: the CHECK constraint name F-05 will add and the raw SQL that
// finds the rows that would VIOLATE it. Empty result = constraint safe to add.
const CHECKS = [
  { name: "products_stock_qty_nonnegative", sql: `SELECT id FROM products WHERE stock_qty < 0` },
  { name: "products_cost_price_nonnegative", sql: `SELECT id FROM products WHERE cost_price < 0` },
  { name: "products_current_price_positive", sql: `SELECT id FROM products WHERE current_price <= 0` },
  { name: "price_tiers_min_qty_positive", sql: `SELECT id FROM price_tiers WHERE min_qty < 1` },
  { name: "price_tiers_price_positive", sql: `SELECT id FROM price_tiers WHERE price <= 0` },
  { name: "sale_items_qty_positive", sql: `SELECT id FROM sale_items WHERE qty < 1` },
  { name: "sale_items_price_per_unit_nonnegative", sql: `SELECT id FROM sale_items WHERE price_per_unit < 0` },
  { name: "purchase_items_qty_positive", sql: `SELECT id FROM purchase_items WHERE qty < 1` },
  { name: "purchase_items_cost_per_unit_nonnegative", sql: `SELECT id FROM purchase_items WHERE cost_per_unit < 0` },
  { name: "sales_total_positive", sql: `SELECT id FROM sales WHERE total <= 0` },
  { name: "purchases_total_nonnegative", sql: `SELECT id FROM purchases WHERE total < 0` },
  { name: "credit_payments_amount_positive", sql: `SELECT id FROM credit_payments WHERE amount <= 0` },
  { name: "supplier_payments_amount_positive", sql: `SELECT id FROM supplier_payments WHERE amount <= 0` },
  { name: "wallet_transactions_amount_nonnegative", sql: `SELECT id FROM wallet_transactions WHERE amount < 0` },
  { name: "stock_movements_purchase_qty_positive", sql: `SELECT id FROM stock_movements WHERE reason = 'PURCHASE' AND qty_change <= 0` },
  { name: "stock_movements_sale_qty_negative", sql: `SELECT id FROM stock_movements WHERE reason = 'SALE' AND qty_change >= 0` },
  { name: "stock_movements_damage_qty_negative", sql: `SELECT id FROM stock_movements WHERE reason = 'DAMAGE' AND qty_change >= 0` },
];

const D6_CHECK = `
  SELECT p.id, p.name, p.stock_qty, COALESCE(m.total, 0) AS sum_qty_change
  FROM products p
  LEFT JOIN (
    SELECT product_id, SUM(qty_change)::int AS total
    FROM stock_movements
    GROUP BY product_id
  ) m ON m.product_id = p.id
  WHERE p.stock_qty <> COALESCE(m.total, 0)
`;

function psqlRows(url, sql) {
  if (!url) return [];
  try {
    const out = execFileSync("psql", [url, "-tA", "-c", sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  } catch (err) {
    throw new Error(`psql failed for ${url}: ${err.stderr?.trim() ?? err.message}`);
  }
}

function validate(url, label) {
  console.log(`\n[validate-f05] ${label} (${url})`);
  let failed = false;

  for (const check of CHECKS) {
    const rows = psqlRows(url, check.sql);
    const status = rows.length === 0 ? "OK" : "VIOLATION";
    console.log(`  ${status.padEnd(10)} ${check.name.padEnd(45)} offending=${rows.length}`);
    if (rows.length > 0) {
      failed = true;
      console.log(`    offending ids: ${rows.slice(0, 20).join(", ")}`);
    }
  }

  const d6 = psqlRows(url, D6_CHECK);
  console.log(`  ${(d6.length === 0 ? "OK" : "VIOLATION").padEnd(10)} D6 stockQty == SUM(qtyChange)  offending=${d6.length}`);
  if (d6.length > 0) {
    failed = true;
    console.log(`    offending rows: ${d6.slice(0, 20).join("; ")}`);
  }

  return failed;
}

function main() {
  let anyViolation = false;

  if (TARGET === "dev" || TARGET === "all") {
    if (validate(DEV_URL, "dev DB (erp_retail)")) anyViolation = true;
  }
  if (TARGET === "test" || TARGET === "all") {
    if (validate(TEST_URL, "test DB (erp_retail_test)")) anyViolation = true;
  }

  if (anyViolation) {
    console.error("\n[validate-f05] VIOLATIONS FOUND — do NOT migrate. Report to PM first.");
    process.exit(1);
  }
  console.log("\n[validate-f05] OK — no rows violate any proposed F-05 constraint; D6 holds. Migration is safe.");
}

main();
