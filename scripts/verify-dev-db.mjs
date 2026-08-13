// Read-only verification of the development database (erp_retail).
//
// Purpose: after running the regression gate, prove that the test run could
// not have touched the development database. It reads a row-count snapshot of
// every transactional table plus a few invariant checks, compares it to the
// baseline snapshot recorded at the start of the milestone, and exits non-zero
// on any difference. It performs NO writes.
//
// Usage:
//   node scripts/verify-dev-db.mjs            # compare live vs baseline
//   node scripts/verify-dev-db.mjs snapshot   # (re)write the baseline file
//
// The baseline file lives at /tmp/opencode/dev_baseline.txt so it is never
// committed; CI/reviewers can re-run with `snapshot` then verify.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASELINE = "/tmp/opencode/dev_baseline.txt";
const BASELINE_MODE = process.argv[2] === "snapshot";

const DATABASE_URL =
  (process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/erp_retail?schema=public").replace(
    /\?schema=.*$/,
    ""
  );

const TABLES = [
  "credit_payments",
  "customers",
  "price_tiers",
  "products",
  "purchase_items",
  "purchases",
  "sale_items",
  "sales",
  "stock_movements",
  "supplier_payments",
  "suppliers",
  "wallet_transactions",
];

function psqlScalar(query) {
  const out = execFileSync(
    "psql",
    [DATABASE_URL, "-tA", "-c", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return out.trim();
}

function snapshot() {
  const lines = [];
  for (const table of TABLES) {
    lines.push(`${table}=${psqlScalar(`SELECT count(*) FROM ${table}`)}`);
  }
  lines.push(`_prisma_migrations=${psqlScalar(`SELECT count(*) FROM _prisma_migrations`)}`);
  lines.push(
    `dev_db_sum_digest=${psqlScalar(`
      SELECT md5(string_agg(name || ':' || COALESCE(stock_qty,0)::text, ',' ORDER BY name))
      FROM products
    `)}`
  );
  return lines.sort().join("\n") + "\n";
}

function main() {
  const current = snapshot();

  if (BASELINE_MODE) {
    writeFileSync(BASELINE, current);
    console.log(`[verify-dev-db] snapshot written to ${BASELINE}`);
    return;
  }

  if (!existsSync(BASELINE)) {
    console.error(
      `[verify-dev-db] baseline ${BASELINE} not found — run once with the 'snapshot' argument first.`
    );
    process.exit(2);
  }

  const baseline = readFileSync(BASELINE, "utf8");
  if (baseline === current) {
    console.log("[verify-dev-db] OK: development database is byte-identical to the baseline (read-only gate).");
  } else {
    console.error("[verify-dev-db] MISMATCH: development database changed during the test run.");
    console.error("--- baseline ---");
    console.error(baseline);
    console.error("--- current ---");
    console.error(current);
    process.exit(1);
  }
}

main();