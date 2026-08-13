# Implementation Log

Work log for the retail ERP. Each milestone records what shipped and the
verification evidence. Business **decisions** live in
[`docs/business-decisions.md`](business-decisions.md) (D1–D7).

All work to date was built incrementally and verified live against a local
PostgreSQL (`erp_retail`) using the Next.js dev server (`npx next dev -p 3001`)
with `curl`/Postman, cross-checking every value with raw SQL. The baseline was
seeded entirely through the HTTP API.

---

## Milestone 1 — Products & Tier Pricing (13 Aug 2026)

**Shipped**

- `modules/products/`: `product.types.ts`, `product.repository.ts`
  (`PrismaProductRepository`, `updateStock`, `updateCostPrice`, accepts a
  transaction client), `product.service.ts` (min-cost bundle `calculatePrice`).
- `app/api/products/route.ts` (`POST`, `GET`), `app/api/products/[id]/route.ts`
  (`GET`).
- Tier pricing is applied greedily (largest qualifying tier first, remainder at
  unit price, no change given — matches real shop behavior). Covered by D1.

**Verified**

- Creating a product with price tiers returns correct tiers and defaults.
- `calculatePrice` min-cost DP vs brute-force matched on all test bundles.

---

## Milestone 2 — Sales (CASH / ECASH / CREDIT) (13 Aug 2026)

**Shipped**

- `modules/sales/`: `sale.types.ts`, `sale.mapper.ts`, `sale.validation.ts`,
  `sale.repository.ts`, `sale.service.ts` (one `$transaction` per sale).
- `app/api/sales/route.ts` (`POST`, `GET`), `app/api/sales/[id]/route.ts` (`GET`).
- Side effects atomically: wallet `DEPOSIT` for CASH/ECASH, customer
  `balanceOwed` increase for CREDIT, signed `StockMovement(SALE)`.
- `SaleItem.pricePerUnit` is frozen (informational, D1); `Sale.total` is
  authoritative.

**Verified**

- CASH sale → wallet +total, stock −qty, no customer row.
- CREDIT sale → customer balance +total, no wallet row.
- `stockQty == Σ movements` after sales.

---

## Milestone 3 — Purchasing, Suppliers & Supplier Payments (13 Aug 2026)

**Shipped**

- `modules/suppliers/`: full module (types, validation, repository, service).
- `modules/purchases/`: types, mapper, validation, repository, service.
- `modules/supplier-payments/`: full module.
- `app/api/suppliers/`, `app/api/suppliers/[id]/`, `app/api/purchases/`,
  `app/api/purchases/[id]/`, `app/api/supplier-payments/`.
- Migration `20260813050516_purchases_payment_type`: `Purchase.paymentType`
  (`CASH`/`CREDIT`), `PurchasePaymentType` enum, `SUPPLIER_PAYMENT` wallet source.
- D3: CASH purchase debits the wallet immediately (same transaction);
  CREDIT purchase raises `Supplier.balanceOwed`, no wallet row. D2:
  `Product.costPrice` = latest purchase `costPerUnit`; `PurchaseItem.costPerUnit`
  is immutable history.

**Verified**

- CASH purchase: wallet −total, supplier balance unchanged, stock +qty.
- CREDIT purchase: supplier balance +total, wallet unchanged, stock +qty.
- Supplier payment: supplier balance −amount, wallet −amount.
- `Product.costPrice` reflects the latest purchase cost.

---

## Milestone 4 — Customers & Customer Credit (13 Aug 2026)

**Shipped**

- `modules/customers/`: mapper, validation, repository, service.
- `modules/customer-payments/`: full module.
- `app/api/customers/`, `app/api/customers/[id]/`, `app/api/customer-payments/`.
- D4: signed `balanceOwed` — negative = prepaid credit, consumed by later
  CREDIT sales. D5: optional `saleId` on payments (must exist 404, belong to the
  customer 400, be a CREDIT sale 400).

**Verified**

- Prepaid lifecycle: owe 100 → pay 300 → balance −200 → CREDIT sale 100 →
  balance −100.
- D5 rejection paths: other-customer sale 400, nonexistent sale 404, CASH-sale
  link 400.

---

## Milestone 5 — Stock Adjustments (DAMAGE / CORRECTION) (13 Aug 2026)

**Shipped**

- `modules/stock/`: `stock.types.ts` (+`StockAdjustmentReason`,
  `AdjustStockInput`, `AdjustStockResult`, repo `list`), `stock.validation.ts`,
  `stock.service.ts` (`adjustStock` in one transaction; `listMovements`).
- `app/api/stock/adjustments/route.ts` (`POST`), `app/api/stock/movements/route.ts`
  (`GET`, optional `productId`).
- D6 semantics: DAMAGE `quantity` = amount ruined (`−quantity`); CORRECTION
  `quantity` = desired final level (`target − current`). Result `< 0` → 409.
  Products start at `stockQty 0`; opening stock via CORRECTION ⇒ invariant
  `Product.stockQty == Σ StockMovement.qtyChange` always holds.

**Verified (live on test data)**

- DAMAGE 3 on stock 40 → 37, movement −3/DAMAGE.
- CORRECTION Oil → target 10 → movement +2, stock 10.
- CORRECTION Biscuits → target 30 → movement −7, stock 30.
- Failures: missing product 404; DAMAGE above stock 409; target < 0 / qty 0 /
  fractional 400; invalid reason 400.
- Atomicity: all table counts unchanged after failed adjustments.
- Reconciliation per product: Rice 13/13, Oil 10/10, Biscuits 30/30 (all OK).

---

## Milestone 6 — Read-only Reporting (13 Aug 2026)

**Shipped**

- `modules/reports/`: `report.types.ts`, `report.validation.ts` (inclusive
  `from ≤ date ≤ to`, local-midnight date coercion, 400 on bad/inverted ranges),
  `report.mapper.ts`, `report.repository.ts` (pure Prisma `aggregate`/`groupBy`),
  `report.service.ts`.
- `GET /api/reports/{sales,purchases,stock,customers,suppliers,wallet}`.
- D7: reports are derived at request time from the transactional tables; never
  store report totals; no COGS/valuation/profit. Every report echoes its applied
  `range`.

**Verified (every figure re-derived via SQL)**

| Report | API vs SQL |
| ------ | ---------- |
| Sales | total 680 / n 5; CASH 380·2, CREDIT 300·3; product qty Biscuits 20, Rice 2 (informational `amount` carries D1 drift) — matches |
| Purchases | total 5020 / n 3; CASH 3500·2, CREDIT 1520·1; supplier Kathmandu Wholesale 5020 — matches |
| Stock | current 30/10/13; movementSummary PURCHASE 83, SALE −22, DAMAGE −3, CORRECTION −5 — matches |
| Customers | outstanding 0, prepaid 105; payment history Ramesh 105·3, Sita 300·1 — matches |
| Suppliers | outstanding 0; payment history 1520·2 — matches |
| Wallet | deposits 785, withdrawals 5020, balance −4235; bySource SALE 380·2, CREDIT_PAYMENT 405·4, SUPPLIER_PAYMENT 5020·4 — matches |

- Date filters: out-of-range → zeros/empty; inclusive `to` end-of-day honored;
  invalid date 400; `from > to` 400.
- Read-only proof: all 11 table counts byte-identical before vs after report
  queries.

---

## Milestone 7 — Concurrency hardening + atomic stock (F-02) (13 Aug 2026)

**Shipped**

- `ProductRepository.reserveStock(id, qty)` — atomic conditional decrement:
  `updateMany({ where: { id, stockQty: { gte: qty } }, data: { stockQty:
  { decrement: qty } } })`, returning the updated product on success or `null`
  when stock is insufficient. Postgres re-evaluates the `WHERE` against the
  latest committed row version under a lock, so two racing transactions cannot
  both win the last unit. Guards `qty` as a positive integer.
- `SaleService.createSale` — step 4 now uses `reserveStock`; a failed reserve
  throws `InsufficientStockError` (409) and rolls the whole sale back. The
  fast-path read check remains for a helpful message; the atomic update is the
  authority.
- `StockService.adjustStock` — DAMAGE now uses `reserveStock` (no read→check→
  write race). CORRECTION keeps the original read→check→write path (target is
  last-writer-wins; documented out of scope for F-02).
- `tests/concurrency/stock.ts` + `npm run test:concurrency` — concurrency
  regression suite running against the dedicated `erp_retail_test` database
  (`TEST_DATABASE_URL`). Refuses to run against any other database.

**Verified**

- All 5 concurrency scenarios pass: 2 parallel sales on last unit; 10 parallel
  sales on stock 5; 2 parallel DAMAGE on stock 2; parallel SALE+DAMAGE on last
  unit; sell-out then purchase replenishment.
- `Product.stockQty == Σ StockMovement.qtyChange` asserted per scenario.
- DAMAGE verified to produce no wallet/customer/supplier side effects.
- HTTP regression (12 checks via curl against the API): CORRECTION seed,
  DAMAGE valid + 409 + 400, SALE valid + 409, CREDIT-sale-without-customer 400,
  movements list, and the stock reconciliation invariant.
- `npx tsc --noEmit`, `npm run lint`, `prisma validate` all green.
- Dev database (`erp_retail`) untouched — row counts identical before/after.
- Tracking: GitHub issue **ERP-001** (F-02: Harden stock concurrency).

---

## Milestone 8 — Product creation validation (F-01) (13 Aug 2026)

**Shipped**

- `modules/products/product.validation.ts` — `validateCreateProductInput(body)`
  mirroring the per-module validator conventions (sales, purchases, stock):
  - body must be a JSON object; `name`/`unit` non-empty trimmed strings with
    length caps (200/50); optional `category` string ≤ 100;
  - `costPrice` finite ≥ 0; `currentPrice` finite > 0;
  - optional `priceTiers` array (≤ 50): `minQty` positive integer ≥ 1, tier
    `price` finite > 0, no duplicate `minQty` within the payload;
  - unknown fields silently ignored (codebase convention).
  All violations throw `ValidationError` → HTTP 400.
- `app/api/products/route.ts` — `POST` now validates (`body as CreateProductInput`
  cast removed) then persists via `PrismaProductRepository`. No service layer
  introduced (F-01 option A: route → validation → repository).
- `tests/unit/product.validation.ts` + `npm run test:unit` — pure validator
  unit tests (tsx + node:assert, no DB).

**Verified**

- `npm run test:unit`: 30/30 pass (valid product, optional fields, invalid
  name/unit/prices, NaN/Infinity/non-finite, invalid tiers, duplicate `minQty`,
  non-object body, unknown fields ignored, clean returned input).
- HTTP regression against `erp_retail_test`: 13/13 pass — valid product 201
  (with and without tiers), malformed JSON 400, non-object 400, missing name 400,
  negative/NaN `currentPrice` 400, negative `costPrice` 400, tier `minQty` 0 400,
  duplicate `minQty` 400, non-array `priceTiers` 400, unknown fields 201. Only
  the 3 valid payloads persisted (no invalid payload leaked into the DB).
- `npx tsc --noEmit`, `npm run lint`, `prisma validate` all green.
- Dev database (`erp_retail`) untouched — row counts identical before/after.
- Tracking: GitHub issue **ERP-002** (F-01: Harden product creation validation
  and service architecture).

---

## Milestone 9 — Error privacy / sanitized 500s (F-03) (13 Aug 2026)

**Shipped**

- `lib/response.ts` — the generic (non-`AppError`) branch of `toHttpResponse`
  no longer returns `error.message`. Every unexpected failure now maps to
  exactly `{ "message": "Internal Server Error" }` with status 500, and the
  original error is logged server-side via `console.error("[unhandled-error]", error)`.
  This is the single choke point all 20 API route handlers already funnel
  through, so no route, service, or repository changed. `AppError` handling
  (400/404/409) is untouched.
- `tests/unit/error-response.ts` + `npm run test:error` — unit tests for
  `toHttpResponse`: every `AppError` subclass keeps status + message; raw
  `Error`, Prisma-style errors (code/meta), connection-string errors, and
  non-`Error` thrown values all map to the sanitized 500; leak-canary
  assertions (driver text, paths, host/port, DB names, `findMany`, stack);
  server-side logging asserted.
- `tests/http/error-handling.ts` + `npm run test:http` — real HTTP integration
  suite that spawns a Next.js dev server against `erp_retail_test`:
  - Phase 1 (test DB): expected errors keep status + message — malformed JSON
    400, invalid product payload 400, CREDIT-without-customer 400, unknown
    product/sale id 404, DAMAGE-above-stock 409, valid product 201 + list 200.
  - Phase 2 (unreachable `DATABASE_URL`): genuine Prisma driver failure proves
    the actual HTTP response is sanitized — `GET /api/products`,
    `POST /api/products`, `GET /api/sales`, and `GET /api/reports/sales` all
    return exactly `{ "message": "Internal Server Error" }` with 500 and no
    leak of paths, Prisma text, DB names, hosts, ports, or driver messages.
  - Guards: refuses to run unless `TEST_DATABASE_URL` points at
    `erp_retail_test`; detects a foreign (developer's) `next dev` server via
    `.next/dev/lock` and fails clearly; cleans up its own servers and stale
    locks on exit. No new dependencies.
- `package.json` — added `test:error` and `test:http` scripts.

**Verified**

- `npm run test:error`: 11/11 pass.
- `npm run test:http`: 12/12 pass (8 Phase-1 regression checks + 4 Phase-2
  sanitized-500 checks with leak-canary assertions).
- Deviation found and fixed during implementation: Next 16 dev writes
  `.next/dev/lock` and refuses a second dev server in the same project —
  harness now handles stale/foreign locks explicitly.
- F-01/F-02 regressions unchanged: `npm run test:unit` 30/30, concurrency 5/5.
- `npx tsc --noEmit`, `npm run lint`, `prisma validate` all green.
- Dev database (`erp_retail`) untouched — all 12 application-table row counts
  byte-identical before/after the suites.
- Tracking: GitHub issue **ERP-003** (F-03: Prevent internal error information
  leakage).

---

## Milestone 10 — Input upper bounds to remove the DoS surface (F-04) (13 Aug 2026)

**Scope (per ERP-004, validation layer only — no service/schema changes):**

- `lib/bounds.ts` — single source of truth for the shared upper caps:
  - `MAX_ITEM_QUANTITY = 100_000` — bounds the `calculatePrice` DP array to
    ~0.8 MB even at maximum (the F-04 DoS was `new Array(qty + 1)`, ~800 MB
    at `quantity: 1e8`).
  - `MAX_ITEMS_PER_DOCUMENT = 100` — mirrors the F-01 tier cap, caps a single
    sale/purchase line list.
  - `MAX_AMOUNT = 10_000_000` — ≈2000× headroom over the largest amount
    observed in real data (~5,020); keeps paisa math well below 2^53.
- Caps wired into the six existing validators (no lower-bound changes, no
  service/repository/schema changes):
  - `sale.validation.ts` — item `quantity ≤ MAX_ITEM_QUANTITY`, ≤ 100 items.
  - `purchase.validation.ts` — item `quantity ≤ MAX_ITEM_QUANTITY`,
    `costPerUnit ≤ MAX_AMOUNT`, ≤ 100 items.
  - `stock.validation.ts` — DAMAGE/CORRECTION `quantity ≤ MAX_ITEM_QUANTITY`.
  - `customer-payment.validation.ts` + `supplier-payment.validation.ts` —
    `amount ≤ MAX_AMOUNT`.
  - `product.validation.ts` — `costPrice`, `currentPrice`, tier `price ≤
    MAX_AMOUNT`, tier `minQty ≤ MAX_ITEM_QUANTITY`.
- Over-limit input → existing `ValidationError` → 400 with
  `… must be at most <max>`. Limits are defensive/security caps, not business
  rules, so no D-number is recorded.
- `tests/unit/input-bounds.ts` + `npm run test:bounds` — boundary/overflow
  unit suite (28/28): values at MAX pass, MAX+1 rejected, message regex, and
  all lower-bound semantics preserved (0/negative still rejected).
- `tests/http/input-bounds.ts` + `npm run test:http:bounds` — real HTTP
  integration suite (11/11) that spawns a Next dev server against
  `erp_retail_test`:
  - **Acceptance criterion proven:** the exact documented DoS payload
    `items[0].quantity = 1e8` returns **400 in well under 15 s** — validation
    rejects it before `calculatePrice`'s allocation is ever reached.
  - Over-limit 400 for sale qty MAX+1, 101-item sale, purchase costPerUnit
    MAX+1, both payment amounts MAX+1, DAMAGE qty MAX+1, product currentPrice
    MAX+1 — each `{ "message": … }` with no 500, no crash.
  - Boundary values still succeed through the full stack: product 201,
    CORRECTION to MAX stock 201, sale of MAX quantity 201 (cap never binds
    legitimate data), and liveness `GET /api/products` 200 afterwards.
  - Same guards as the F-03 suite: refuses to run unless `TEST_DATABASE_URL`
    points at `erp_retail_test`; detects foreign `next dev` servers via
    `.next/dev/lock`; cleans up its own server and stale locks on exit.
- `package.json` — added `test:bounds` and `test:http:bounds`.

**Verified**

- `npm run test:bounds`: 28/28 pass.
- `npm run test:http:bounds`: 11/11 pass.
- `npm run test:unit`: 30/30, `npm run test:error`: 11/11, `npm run test:http`:
  12/12, `npm run test:concurrency`: 5/5 — all regressions unchanged.
- `npx tsc --noEmit`, `npm run lint`, `prisma validate` all green.
- Dev database (`erp_retail`) untouched — all application-table row counts
  byte-identical before/after the suites; no stray `next dev` servers left.
- Tracking: GitHub issue **ERP-004** (F-04: DoS via unbounded quantity input) —
  *closed (PM-approved), Milestone 10 complete.*

---

## Milestone 11 — Automated regression suite as the gate (F-15, ERP-005) (13 Aug 2026)

**Scope (per ERP-005, test layer only — no service/schema changes):**

- Extended the automated framework into a full D1–D7 regression gate that runs
  entirely against the dedicated `erp_retail_test` database. Every suite refuses
  to run unless `TEST_DATABASE_URL` points at `erp_retail_test`; `createDbSuite`
  auto-reconciles the D3/D4/D6/wallet invariants after every scenario.
- `tests/helpers/db.ts` — `resolveTestDbUrl` guard, `createTestPrisma`,
  `truncateAll`, `tableCounts`, `reconcile` (D3/D4/D6/wallet invariants).
- `tests/helpers/seed.ts` — `createProduct`, `createCustomer`,
  `createSupplier`, `seedStock` (through repos/services).
- `tests/helpers/runner.ts` — `createUnit` / `createDbSuite`.
- `tests/helpers/http.ts` — dev-server lifecycle + port selection,
  `startServer/stopServer/waitReady/httpGet/httpPost/errorBody/
  ensureNoForeignDevServer` (handles the Next 16 `.next/dev/lock` guard).
- Unit suites (new): `tests/unit/pricing.ts` (6/6 — D1 tier price
  calculation), `tests/unit/validators.ts` (30/30 — D1–D7 request-validator
  coverage).
- Integration suites (new, all against `erp_retail_test`):
  - `tests/integration/sales.ts` 10/10 — CASH/ECASH/CREDIT, tier pricing,
    multi-item, failures S6–S9, S10 balance untouched.
  - `tests/integration/purchases.ts` 6/6 — CASH/CREDIT, D2 cost repricing,
    failures P4/P5.
  - `tests/integration/customer-payments.ts` 8/8 — D4 prepaid lifecycle,
    D5 sale-link, failures C4–C7.
  - `tests/integration/supplier-payments.ts` 5/5 — SP1–SP5.
  - `tests/integration/stock-adjustments.ts` 8/8 — DAMAGE/CORRECTION,
    failures A5–A7, ledger A8.
  - `tests/integration/rollback.ts` 8/8 — R1 acceptance (multi-line sale with
    one out-of-stock line leaves zero partial rows), R0 positive control,
    R7 happy-path counts.
  - `tests/integration/ledger.ts` 2/2 — L1 all-ledger raw-SQL reconciliation;
    L2 prepaid credit cycle.
  - `tests/integration/reports.ts` 2/2 — RP1 every report cross-checked
    against raw SQL plus a read-only table-count proof; RP2 range filtering.
- `tests/http/d1-d7-smoke.ts` 15/15 — full D1–D7 API walk over real HTTP:
  products, stock adjustments, purchases CASH/CREDIT, supplier-payments,
  customers, sales CASH/ECASH/CREDIT, customer-payments, reports, 404s, and
  final liveness.
- `package.json` — per-suite scripts (`test:unit:pricing`, `test:unit:validators`,
  `test:integration:*`, `test:http:smoke`) plus `test:all`, the full D1–D7 gate.
  No new dependencies (tsx + node:assert only).

**Verified**

- `npm run test:all` (the whole gate): **17 suites, 197 assertions, 0 failures,
  exit 0** — unit 30/30, error 11/11, pricing 6/6, validators 30/30,
  concurrency 5/5, bounds 28/28; integration sales 10/10, purchases 6/6,
  customer-payments 8/8, supplier-payments 5/5, stock 8/8, rollback 8/8,
  ledger 2/2, reports 2/2; http error 12/12, http bounds 11/11, http smoke 15/15.
- `npx tsc --noEmit` green and `npm run lint` green with **0 warnings**.
- Dev database (`erp_retail`) untouched — all 12 application-table row counts
  byte-identical before/after the full gate; tests touched only `erp_retail_test`.
- Tracking: GitHub issue **ERP-005** (F-15: Automated regression suite as the
  gate) — left open, evidence commented for PM review.

---

## Milestone 12 — Regression suite standardized on Vitest (F-15, ERP-005) (13 Aug 2026)

**Scope (per ERP-005 follow-up, test layer only — no service/schema changes):**

- Replaced the committed tsx + node:assert hand-rolled runners with **Vitest
  3.x as the single test runner** (no Jest, no dual setup). Everything was
  migrated **in place** from HEAD `a69db89`; behavioral coverage preserved
  one-for-one.
- `vitest.config.ts` — `environment: node`, `pool: forks`,
  `fileParallelism: false` (DB-touching files stay serialized against the
  single shared `erp_retail_test` DB), `setupFiles: tests/setup.ts`
  (`dotenv/config`), long timeouts, alias `@` → repo root.
- `tests/setup.ts` — loads `.env` before any import resolves config.
- Guards preserved but converted from `process.exit(1)` to throws so Vitest
  reports a guard failure as a test error instead of killing the process:
  `resolveTestDbUrl()` (may only point at `erp_retail_test`) and
  `ensureNoForeignDevServer()` (Next dev lock guard).
- All 197 tests carried over into `*.test.ts` (Vitest describe/it/expect):
  - Unit (105): F-01 product validation (30), error-response (11), pricing
    D1 (6), validators D1–D7 (30), F-04 input bounds (28).
  - Integration (49): sales S1–S10, purchases P1–P6, customer-payments
    C1–C8, supplier-payments SP1–SP5, stock A1–A8, rollback R0–R7 (snapshot
    rollback assertions preserved), ledger L1–L2 (raw-SQL re-derivations
    preserved), reports RP1–RP2.
  - Concurrency (5): F-02 S1–S5 with real `Promise.allSettled` races
    preserved.
  - HTTP (38): F-03 error-handling (12, incl. unreachable-DB leak-canaries),
    F-04 input-bounds (11), D1–D7 smoke (15). Server lifecycle now via
    Vitest `beforeAll`/`afterAll` so the spawned Next dev server is always
    stopped on pass or fail.
- Removed the old `.ts` suites, `tests/helpers/runner.ts`, and the `tsx`
  devDependency+scripts; `package.json` scripts now map to `vitest run`
  per directory. `tsx` left out of devDependencies (no other consumer).
- `scripts/verify-dev-db.mjs` — read-only proof that the gate cannot touch
  the development database: snapshots every `erp_retail` table row count +
  a product digest, diffs against the baseline, fails non-zero on change.

**Verified**

- `npm run test:all` (the whole gate): **17 suites, 197 tests, 0 failures,
  exit 0** — unit 105/105, integration 49/49, concurrency 5/5, http 12/12,
  http bounds 11/11, http smoke 15/15. Matches the committed tsx baseline
  count exactly (197).
- `npx tsc --noEmit` green and `npm run lint` green with 0 warnings; also
  `npx prisma validate` green.
- `node scripts/verify-dev-db.mjs`: development database (`erp_retail`)
  byte-identical to the baseline — all 12 application-table row counts +
  product digest unchanged; tests touched only `erp_retail_test`.
- No stray `next dev`/`tsx`/`vitest` processes after the gate; `.next/dev/lock`
  cleaned up.
- Tracking: GitHub issue **ERP-005** (F-15) — left open, Vitest evidence
  commented for PM review.

---

## Current state (13 Aug 2026)

- **Done:** Products/Pricing, Sales, Purchasing, Suppliers + Supplier Payments,
  Customers + Credit Payments, Stock Adjustments, Reporting, plus audit fixes
  F-02 (concurrency), F-01 (product validation), F-03 (error privacy),
  F-04 (input upper bounds), F-15 (automated regression suite as the gate,
  now standardized on Vitest).
  All green on `tsc --noEmit` and `eslint`; the full `npm run test:all` gate
  (17 suites, 197 tests) passes against `erp_retail_test`.
- **Test data:** Rice stock 13, Oil 10, Biscuits 30; Kathmandu Wholesale balance
  0; customers Ramesh −5, Sita −100 (prepaid); wallet −4235; credit payments 405.
- **Postman:** `postman/Retail-ERP.postman_collection.json` — 58 requests,
  9 folders (Products, Suppliers, Purchases, Supplier Payments, Stock
  Adjustments, Customers, Customer Payments & Credit Lifecycle, Sales — Tier
  Pricing & Payment Types, Reports).
- **Next:** remaining P1 audit fixes (F-10 auth, F-05 DB constraints/indexes) —
  each a separate planned milestone.
