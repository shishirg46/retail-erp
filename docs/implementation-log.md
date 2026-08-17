# Implementation Log

Work log for the retail ERP. Each milestone records what shipped and the
verification evidence. Business **decisions** live in
[`docs/business-decisions.md`](business-decisions.md) (D1–D7).

## Milestone M24 — DB Initialization + Realistic Data Seed (17 Aug 2026)

**Shipped**

- `scripts/seed-dev-data.ts`: Pure data definitions for a realistic dev dataset.
  - 18 products (5 units, 5 tiered, 5 packaged with unitsPerPack).
  - 5 suppliers with varied opening balances (Rs 0–15,000).
  - 18 customers with varied opening balances (Rs 0–3,000).
  - 11 purchases (7 CASH, 4 CREDIT) across 5 suppliers.
  - 36 sales (18 CASH, 12 CREDIT, 6 ECASH) across 16 customers.
  - 10 credit payments (3 linked to specific sales, 7 general account).
  - 5 supplier payments.
  - 3 stock adjustments (DAMAGE, CORRECTION).
  - 2 OWNER_WITHDRAWAL entries (direct wallet writes).
  - 4 voids: void SALE, void CREDIT_PAYMENT, void STOCK_MOVEMENT, void PURCHASE.
- `scripts/seed-dev.ts`: Main seed script (idempotent, dev-only).
  - DB guard: refuses test/production databases.
  - Truncates all application + auth tables before seeding.
  - Seeds OWNER user via Better Auth scrypt hash.
  - Seeds via production services/repositories (not raw SQL) — exercises the
    same code paths production will use.
  - Creates wallet opening deposit transaction (source=OTHER) for D18 consistency.
  - Independent verification: re-derives D3/D4/D6/D18 invariants from persisted
    DB records (not from seed data definitions).
  - Dry-run mode (`--dry`): prints plan without touching DB.
- `package.json`: Added `db:seed` and `db:seed:dry` scripts.
- `tests/helpers/db.ts`: `reconcile()` updated to include OWNER_WITHDRAWAL in
  expectedWithdrawals — the wallet invariant now accounts for manual owner
  withdrawals as legitimate WITHDRAWAL entries.

**Verified**

- `npx tsc --noEmit` clean; `npm run lint` clean (0 errors, 0 warnings).
- `npm run test:unit` — 223/223 passed.
- `npm run test:frontend` — 108/108 passed.
- `npm run db:seed` — seeded 18 products, 5 suppliers, 18 customers, 11 purchases,
  36 sales, 10 credit payments, 5 supplier payments, 3 stock adjustments,
  2 owner withdrawals, 4 voids against `erp_retail` dev DB.
- All 4 reconciliation invariants hold after seeding:
  - D6: stockQty == Σmovements per product (18 products).
  - D4: balanceOwed == openingBalance + ΣCREDIT sales - Σcredit payments (18 customers).
  - D3: balanceOwed == openingBalance + ΣCREDIT purchases - Σsupplier payments (5 suppliers).
  - D18: wallet deposits == ΣnonCreditSales + ΣcreditPayments + voidedCashPurchases + voidedSupPayRows + walletOpening; wallet withdrawals == ΣcashPurchases + ΣsupplierPayments + voidedNonCreditSales + voidedCreditPayments + ownerWithdrawals.
- Wallet balance: Rs 764.06 (opening Rs 500 + deposits Rs 773.81 - withdrawals Rs 509.75).

---

All work to date was built incrementally and verified live against a local
PostgreSQL (`erp_retail`) using the Next.js dev server (`npx next dev -p 3001`)
with `curl`/Postman, cross-checking every value with raw SQL. The baseline was
seeded entirely through the HTTP API.

---

## Milestone M23 — Pre-Phase-D Data-Model Foundation (17 Aug 2026)

**Shipped**

- D26: Opening balances for customers and suppliers (schema + API).
  - `customers.opening_balance` and `suppliers.opening_balance` columns (Decimal 12,2, default 0).
  - `balanceOwed` initialized to `openingBalance` at creation time for correct invariant.
  - Customer creation route changed to OWNER-only (opening balance protection).
  - Supplier creation route was already OWNER-only.
- D26: Shop Settings singleton module.
  - New `shop_settings` table (singleton pattern, id = "singleton").
  - `goLiveAt` (timestamp, nullable) and `walletOpeningBalance` (Decimal 12,2, default 0).
  - `GET /api/settings` and `PATCH /api/settings` endpoints (OWNER-only).
- D27: OPENING stock reason.
  - Added `OPENING` to `stock_reason` enum.
  - OWNER-only authorization (CASHIER gets 403).
  - Guard: requires `product.stockQty === 0` (returns 400 otherwise).
  - Creates stock movement with reason `OPENING`.
- D28: `unitsPerPack` for packaged products.
  - `products.units_per_pack` column (Integer, nullable, default null).
  - Only valid for `pcs` unit products (≥ 2 when set).
  - Persisted and returned in product create/get API responses.
- D29: Customer POST route changed from `[OWNER, CASHIER]` to `[OWNER]`.
- Reconciliation formulas updated:
  - D4: `balanceOwed == openingBalance + Σ(CREDIT sales) − Σ(credit payments)`.
  - D3: `balanceOwed == openingBalance + Σ(CREDIT purchases) − Σ(supplier payments)`.
  - D18 wallet: `balance = walletOpeningBalance + Σ(DEPOSIT) − Σ(WITHDRAWAL)`.
- Wallet report balance includes `walletOpeningBalance` from ShopSettings.
- `truncateAll` test helper updated to include `shop_settings` table.
- Settings GET route bug fixed: passes actual `req` instead of `{} as NextRequest`.

**Verified**

- `npx tsc --noEmit` clean; `npm run lint` clean.
- `npm run test:unit` — 223/223 passed.
- `npm run test:frontend` — 108/108 passed.
- `npm run test:integration` — 111/111 passed (19 new pre-phase-d regression tests).
- Pre-phase-d regression suite covers: opening customer/supplier balances,
  settings GET/PATCH, OPENING stock (success + guard + auth), unitsPerPack
  (create + read + validation), sale item productName + lineTotal, stock
  movement productName, purchase item productName.

---

## Milestone M22 — D25 fractional quantity domain and tier-first pricing (16 Aug 2026)

**Shipped**

- Quantity columns widened to `DECIMAL(18,2)` for `products.stock_qty`,
  `price_tiers.min_qty`, `sale_items.qty`, `purchase_items.qty`, and
  `stock_movements.qty_change`.
- Supported units are frozen to `pcs`, `kg`, `g`, `liter`, and `ml` at the DB and
  service/validator layers; `pcs` remains integer-only while measurable units allow
  up to 2 decimal places.
- Business-facing quantity caps are kept human-readable at `1000.00` and never
  surfaced as scaled-unit values.
- Tier pricing keeps the shop's largest-tier-first + remainder behavior with
  integer-hundredth scaling at the domain boundary for exact arithmetic.

**Verified**

- Fractional quantities `0.25`, `0.50`, `1.50`, `2.25`, and `2.50` are accepted
  for measurable units and rejected beyond 2 dp.
- `pcs` items reject fractional quantities.
- Fractional tier thresholds and remainder pricing behave as expected.
- `npx tsc --noEmit`, `npm run lint`, and the relevant unit verification suite are green.

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
- Tracking: GitHub issue **ERP-005** (F-15) — **closed PM-approved** after
  evidence review; no further F-15 changes.

---

## Milestone 13 — DB hardening: CHECK constraints + report indexes (F-05, ERP-006) (14 Aug 2026)

**Scope (per ERP-006 — schema + migration + tests only; no application-service
or repository changes):**

- `prisma/schema.prisma` — 9 targeted `@@index` declarations (explicit `map`
  names) on report/FK hot paths:
  - `credit_payments(customerId, date)`, `purchase_items(purchaseId)`,
    `purchases(date)`, `sale_items(saleId)`, `sales(date)`,
    `stock_movements(productId, date)`, `stock_movements(date)`,
    `supplier_payments(supplierId, date)`, `wallet_transactions(date)`.
- Migration `20260814034336_db_hardening_f05` — the 9 `CREATE INDEX`
  statements plus **17 `CHECK` constraints** appended as DB-layer backstops
  that restate rules already enforced by the services/validators:
  - Non-negativity/positivity: `products_stock_qty_nonnegative` (`stock_qty >= 0`),
    `products_cost_price_nonnegative`, `products_current_price_positive`,
    `price_tiers_min_qty_positive` (`>= 1`), `price_tiers_price_positive`,
    `sale_items_qty_positive` (`>= 1`),
    `sale_items_price_per_unit_nonnegative`, `purchase_items_qty_positive`
    (`>= 1`), `purchase_items_cost_per_unit_nonnegative`, `sales_total_positive`
    (`> 0`), `purchases_total_nonnegative`, `credit_payments_amount_positive`,
    `supplier_payments_amount_positive`, `wallet_transactions_amount_nonnegative`.
  - Signed stock-movement semantics per reason: `stock_movements_purchase_qty_positive`
    (`reason <> 'PURCHASE' OR qty_change > 0`),
    `stock_movements_sale_qty_negative` (`reason <> 'SALE' OR qty_change < 0`),
    `stock_movements_damage_qty_negative` (`reason <> 'DAMAGE' OR qty_change < 0`).
  - Signed ledger semantics deliberately preserved: `customers.balance_owed`
    and `suppliers.balance_owed` are **not** constrained (prepaid D4 /
    overpayment D3 stay legal); CORRECTION is deliberately unconstrained
    (a no-op CORRECTION legitimately writes `qty_change = 0`).
- `scripts/validate-f05-preconditions.mjs` — pre-migration validator proving
  every existing row in both `erp_retail` and `erp_retail_test` already
  satisfies each proposed constraint plus the D6 invariant, before the
  migration runs.
- `tests/integration/db-hardening.test.ts` — **24/24**:
  - 17 CHECK constraints exist in `pg_constraint`; 9 indexes exist in
    `pg_indexes` (not just in the migration file).
  - 17 raw-SQL invalid-row rejections, each inside a transaction that rolls
    back (negative stock/price, zero/negative quantities, `total <= 0`,
    `amount <= 0`, wrong movement signs).
  - Positive controls: prepaid customer balance stays negative (D4), overpaid
    supplier balance stays negative (D3), CORRECTION `qty_change 0` accepted,
    valid PURCHASE(+) / SALE(−) signs work end-to-end, and the D3/D4/D6 +
    wallet reconciliation invariants hold after signed ledgers.
- Applied to both databases: dev via `npx prisma migrate dev`, test via
  `npx prisma migrate deploy`.

**Verified**

- Preconditions: `node scripts/validate-f05-preconditions.mjs all` — all 17
  constraint checks + D6 pass on both `erp_retail` and `erp_retail_test`
  (0 violations, dev rows: 3 products / 5 sales / 13 stock movements /
  10 wallet transactions / 2 prepaid customers / 1 supplier).
- `npx prisma migrate status` — "Database schema is up to date!" on both DBs;
  all 17 constraints present in `pg_constraint` and all 9 indexes in
  `pg_indexes` on both databases.
- Gate: `npx tsc --noEmit` green; `npm run lint` green (0 warnings);
  `npx prisma validate` green; `npm run test:all` — **18 suites, 221 tests,
  0 failures, exit 0** (unit 105/105, integration 73/73 incl. the new
  db-hardening 24/24, concurrency 5/5, http error 12/12, http bounds 11/11,
  http smoke 15/15).
- Dev database (`erp_retail`) byte-identical to baseline after the full gate
  (`node scripts/verify-dev-db.mjs`).
- Tracking: GitHub issue **ERP-006** (F-05) — evidence commented, left open
  for PM review per the approved plan.

---

## Milestone 14 — Authentication & authorization (F-10, ERP-007) (14 Aug 2026)

**Scope (per ERP-007, D9 approved by PM):** local username+password
authentication delegated to **Better Auth** (self-hosted, database-backed),
an OWNER/CASHIER role matrix, every ERP route guarded, and OWNER user
management. Explicitly out of scope: OAuth/MFA/public sign-up, frontend UI,
audit log, F-06/07/08/09/11.

- **Schema** — migration `20260814050107_auth_f10` adds the four core Better
  Auth tables (`user`, `session`, `account`, `verification`, quoted reserved
  words) plus `user.role` (`OWNER`/`CASHIER`, default `CASHIER`) and
  `user.username` (fed by Better Auth's `username` plugin with
  `additionalFields: { username }` so `data.username` lands on the column).
- **`lib/auth.ts`** — Better Auth instance: email+password (sign-up disabled,
  min 8 chars), `username` + `admin` (`adminRoles: ["OWNER"]`) plugins, 12h
  sessions, 6h sliding window, cookie prefix `erp`. Password hashes live in
  `account.password` (`salt:key` scrypt from `@better-auth/utils/password`).
- **`lib/auth/authorize.ts`** — `assertSameOrigin` (D9.9: a present `Origin`
  header on a state-changing method must match the request's own origin; absent
  Origin — non-browser clients — is allowed), `requireUser` (D9.8 authoritative
  DB-backed session lookup → 401), `requireRole` (D9.3 matrix → 403).
- **`lib/errors.ts`** — `UnauthorizedError` (401, "Authentication required"),
  `ForbiddenError` (403, "Insufficient permissions" / "Cross-origin request
  rejected").
- **`proxy.ts`** — coarse network-boundary gate (D9.8): `/api/*` carrying no
  session cookie → 401 without touching the DB; `/api/auth/*` excluded so
  sign-in is reachable. Never authoritative — every route re-checks.
- **`app/api/auth/[...all]/route.ts`** — Better Auth's HTTP entry; blocks
  `/api/auth/admin/*` with 404 so the admin plugin's `user.email` leak surface
  is unreachable (D9.10).
- **`modules/users/` + `app/api/users/`** — OWNER-only user management:
  create (derived internal email `<username>@erp.local`, D9.10), list/get,
  role update, ban/unban, reset-password (revokes all of that user's sessions,
  D9.5), delete. `toUserAdminView` never exposes the email/emailVerified.
  Last-active-OWNER invariant: demote/ban/delete of the last active OWNER →
  400.
- **Guard coverage** — all ERP routes guarded per D9.3: CASHIER = sales,
  customers (view/create), customer payments, stock adjustments, stock
  movements, sales + stock reports; everything else OWNER-only.
- **`scripts/seed-owner.mjs`** — idempotent initial OWNER seed using Better
  Auth's own scrypt hash, so the credential verifies at real sign-in.
- **Behavioral fix** — Better Auth swallows session-lookup errors into `null`,
  so a dead database is indistinguishable from an invalid token; `requireUser`
  probes the DB with a no-op query on the null path so an unreachable database
  surfaces as a sanitized 500 (server fault) while a genuinely invalid session
  still gets 401. Keeps the F-03 unreachable-DB leak-canary HTTP proof green
  under the auth gate.

**Commits** (granular per the approved plan): `b1bd02d` (core + schema +
guards), `975d1e4` (guard all routes + user management), `e276e6b` (dead-DB →
sanitized 500), `d491bde` (F-10 suites + authenticate existing HTTP suites),
`c7bfb67` (route warming for the dev route-discovery race + wire `test:auth`
into the gate).

**Verified**

- `npx tsc --noEmit` and `npm run lint` green; `npx prisma validate` green.
- `npm run test:all` — **21 suites, 259 tests, 0 failures, exit 0**: unit
  126/126 (incl. auth-config 10, user-management 11), integration 73/73,
  concurrency 5/5, HTTP error 12/12 (incl. unreachable-DB leak-canaries),
  HTTP bounds 11/11, HTTP smoke 15/15, F-10 HTTP auth-flow **17/17** — sign-in
  lifecycle, proxy gate, D9.8 forged-cookie 401, D9.3 CASHIER 403 matrix,
  D9.9 cross-origin (foreign → 403, matching → allowed), D9.10 admin endpoints
  404 + no email exposure, user create/get/delete, role promote/demote,
  last-active-OWNER invariant, ban blocks sign-in + unban restores, D9.5 reset
  revokes sessions.
- Dev database (`erp_retail`) byte-identical to baseline after the full gate
  (`node scripts/verify-dev-db.mjs`; baseline refreshed once to include the
  F-10 migration row in `_prisma_migrations` — all 12 application tables and
  the digest unchanged).
- Manual dev-server checks: matching-origin POST → 403 "Cross-origin request
  rejected", no session cookie → 401, forged cookie → 401 (authoritative check),
  `/api/auth/admin/list-users` → 404, sign-up disabled.
- Tracking: GitHub issue **ERP-007** (F-10) — evidence to comment, **left open
  for PM review** per the approved plan. D9 decisions recorded in
  `docs/business-decisions.md`.

---

## Milestone 15 — Shop-local timezone + integer-paisa money (F-06/F-09, ERP-008) (14 Aug 2026)

**Scope (per ERP-008; D10 + D11 — application code only, no schema migration):**

- **D10 (`lib/timezone.ts`)** — shop-local date semantics with no schema
  change: `ERP_TIMEZONE` (default `Asia/Kathmandu`) read at runtime from
  `process.env`. Naive `YYYY-MM-DD` report params are interpreted as shop-local
  wall clock via an Intl-offset technique (`naiveAsShopLocal`,
  `shopLocalDayStart`, `formatShopLocal`); full ISO strings with an explicit
  zone (`Z`/`±hh:mm`/`[IANA]`) parse as-is; the report `range` echo is a
  shop-local offset string, never `.toISOString()`; impossible dates
  (`2026-99-99`) are rejected 400.
- **D11 (`lib/money.ts`)** — integer-paisa domain money. Validators convert
  rupees→paisa once (`rupeesToPaisa`, round-half-up, exactly once); services,
  repositories, and reports do all math in whole paisa; repositories write
  `paisaToRupees` → Postgres `DECIMAL` (rupees) and read `paisaFromDecimal`;
  routes convert paisa→rupees at the response boundary via `to*Api` mappers.
  `MAX_AMOUNT_PAISA = MAX_AMOUNT × 100`. The 12 audit money fields converted:
  `products.cost_price/current_price`, `price_tiers.price`,
  `suppliers.balance_owed`, `customers.balance_owed`, `purchases.total`,
  `purchase_items.cost_per_unit`, `supplier_payments.amount`, `sales.total`,
  `sale_items.price_per_unit`, `credit_payments.amount`,
  `wallet_transactions.amount`.
- **Converted modules** — `lib/money.ts`, `lib/timezone.ts`;
  validators (`product`, `purchase`, `customer-payment`, `supplier-payment`);
  services (`SaleService.effectiveUnitPrice = Math.round(totalPaisa / qty)`,
  `ProductService.calculatePrice` paisa ints); repositories + `to*Api` mappers
  (products, sales, purchases, customers, suppliers, customer-payments,
  supplier-payments, wallet); `report.repository.ts` (whole-paisa sums, one
  `paisaToRupees` at payload construction, `formatShopLocal` range echo);
  `report.validation.ts` (shop-local naive parsing); all 13 money route
  handlers converted at the rupee response boundary (products, sales,
  purchases, suppliers, customers, customer-payments, supplier-payments).
  `report.mapper.ts` documents that report money must use `paisaFromDecimal`.
- **Robustness refactor (ride-along)** — `lib/auth/session-cookie.ts` shared
  `SESSION_COOKIES` + `hasSessionCookie`; `proxy.ts` uses it; `requireUser`
  short-circuits 401 when no session cookie is present, else falls through to
  the DB-backed lookup + `SELECT 1` probe (preserves the F-03 dead-DB →
  sanitized 500 contract). `getUtcOffsetMs` fixed for sub-second round-trips
  (`fractionalSecondDigits: 3`, `Number(values.fractionalSecond)`).
- **Tests** — new `tests/unit/money.test.ts` (12) and
  `tests/unit/timezone.test.ts`; converted paisa expectations across
  `pricing`, `validators`, `input-bounds`, `product.validation` unit suites and
  the sales/purchases/customer-payments/supplier-payments/db-hardening/ledger/
  reports integration suites (seed helpers take paisa; DB rows are read back
  via `paisaFromDecimal`); HTTP suites keep rupee expectations (unchanged) and
  all four HTTP suites now `warmRoutes` every path they exercise (fixes the
  dev route-discovery race across the full gate).

**Verified**

- `npx tsc --noEmit`, `npm run lint` (0 warnings), `npx prisma validate` all
  green.
- `npm run test:all` — **23 test files, 283 tests, 0 failures, exit 0**: unit
  150/150 (incl. money 12 + timezone new), integration 73/73, concurrency 5/5,
  HTTP error 12/12 (incl. unreachable-DB leak-canaries), HTTP bounds 11/11,
  HTTP smoke 15/15, F-10 HTTP auth-flow 17/17. Report/HTTP rupee values proven
  unchanged end-to-end; paisa domain values exact.
- Dev database (`erp_retail`) byte-identical to baseline after the full gate
  (`node scripts/verify-dev-db.mjs`) — D11 changed no persisted values.
- Note: the suite run required stopping a foreign dev server (`.next/dev/lock`
  guard) before the HTTP suites could spawn.
- Tracking: GitHub issue **ERP-008** (F-06/F-09) — created, evidence to
  comment, **left open for PM review**. D10/D11 recorded in
  `docs/business-decisions.md`.

---

## Current state (14 Aug 2026)

- **Done:** Products/Pricing, Sales, Purchasing, Suppliers + Supplier Payments,
  Customers + Credit Payments, Stock Adjustments, Reporting, plus audit fixes
  F-02 (concurrency), F-01 (product validation), F-03 (error privacy),
  F-04 (input upper bounds), F-15 (automated regression suite as the gate,
  now standardized on Vitest), F-05 (DB hardening: 17 CHECK constraints +
  9 report indexes), **F-10 (authentication & authorization: Better Auth,
  OWNER/CASHIER matrix, all routes guarded, OWNER user management)**, and
  **F-06/F-09 (integer-paisa domain money D11 + shop-local timezone D10)**.
  All green on `tsc --noEmit` and `eslint`; the full `npm run test:all` gate
  (23 test files, 283 tests) passes against `erp_retail_test`.
- **Test data:** Rice stock 13, Oil 10, Biscuits 30; Kathmandu Wholesale balance
  0; customers Ramesh −5, Sita −100 (prepaid); wallet −4235; credit payments 405.
- **Postman:** `postman/Retail-ERP.postman_collection.json` — 58 requests,
  9 folders (Products, Suppliers, Purchases, Supplier Payments, Stock
  Adjustments, Customers, Customer Payments & Credit Lifecycle, Sales — Tier
  Pricing & Payment Types, Reports). Collection calls now need a session cookie
  (sign in first) once F-10 is live.
- **Next:** PM review of **ERP-007** (F-10 evidence) and **ERP-008** (F-06/F-09
  evidence); remaining audit fixes F-07/08/11 require their own business
  decisions before code.

---

## Milestone 16 — Cursor-based pagination, search, and filtering (D12 / F-07) (15 Aug 2026)

**Shipped**

- `lib/pagination.ts` — shared pagination library: cursor encode/decode
  (`date|id` → base64url), query param parsing (`cursor`, `limit`, per-endpoint
  filters), response types (`PaginatedResponse<T>`, `PagingMeta`), validation
  (max 500, invalid cursor → 400), `buildPaginatedResponse` helper.
- **8 list endpoints** updated with optional cursor-based pagination:
  - `GET /api/products` — `search` (name), `category` filter, `createdAt DESC, id DESC`
  - `GET /api/customers` — `search` (name), `createdAt DESC, id DESC`
  - `GET /api/suppliers` — `search` (name), `createdAt DESC, id DESC`
  - `GET /api/sales` — `paymentType` filter, `date DESC, id DESC`
  - `GET /api/purchases` — `paymentType`, `supplierId` filters, `date DESC, id DESC`
  - `GET /api/supplier-payments` — `supplierId` filter, `date DESC, id DESC`
  - `GET /api/customer-payments` — `customerId` filter, `date DESC, id DESC`
  - `GET /api/stock/movements` — `productId` (existing), `reason` filter, `date DESC, id DESC`
- **Backward compatible:** no pagination params → existing raw-array response;
  any pagination param present → `{ data, paging }` envelope.
- Default page size: 50. Maximum: 500. Cursor ordering: `date DESC, id DESC`.
- Master-data ordering: `createdAt DESC, id DESC`.
- `Product` type now exposes `createdAt` (was already in the DB, previously
  omitted from the domain type).
- Repository `listPaginated()` methods added to all 8 repositories.
- Service `listXxxPaginated()` methods added where services were the route entry
  point (sales, purchases, supplier-payments, customer-payments, stock).

**Verified**

- `tsc --noEmit` green; `npm run lint` green.
- `tests/unit/pagination.test.ts` — 23 tests: cursor round-trip, base64url
  format, identical-timestamp tiebreaker, invalid cursor rejection, param
  parsing, filter parsing, `buildPaginatedResponse` edge cases, constants.
- `tests/http/pagination.test.ts` — 32 tests: backward-compat raw arrays for
  all 8 endpoints, paginated envelope for all 8, cursor traversal, filter
  behavior (search, category, paymentType, supplierId, productId, reason),
  invalid query params (400), limit clamping, deterministic ordering.
- All existing unit tests (173/173) and HTTP tests (d1-d7-smoke 15/15,
  input-bounds 11/11) pass. `error-handling.test.ts` passes in isolation
  (pre-existing parallel port-collision issue).

---

## Milestone 18 — Transaction void/correction (ERP-009) (15 Aug 2026)

**Shipped**

- `modules/voids/` — full module: `void.types.ts` (`VoidTargetType`, `VoidInfo`,
  `VoidStatusOutput`, `VoidInput`), `void.validation.ts`, `void.repository.ts`
  (`VoidRecord` + `voidedIds(targetType)` helper + `attachVoidStatus`),
  `void.service.ts` (OWNER-only, whole-transaction, one `$transaction` per
  void). Original rows are never deleted; voiding posts **offsetting reversal
  rows** carrying origin FKs (wallet source `VOID`, stock reason `VOID`).
  `void.repository.ts` also exposes `attachVoidStatus` and the
  `listVoidedTargetIds(targetType)` helper.
- **5 void endpoints**, all `POST .../void` and OWNER-only (D18.1):
  sales, purchases, credit payments (customer-payments), supplier payments,
  stock movements (`reason: CORRECTION` only — DAMAGE voids are rejections).
- Double-void prevented by a unique `(targetType, targetId)` constraint plus a
  repository-level `assertNotVoided` (P2002 → 409 Conflict).
- D18.4: a sale with an active linked credit payment cannot be voided;
  new payments to a voided sale are rejected.
- D18.5 (Option A): voiding a **purchase** re-derives the product `costPrice`
  from surviving non-voided purchases via the `VoidService.latestNonVoidedCost`
  private helper; if no non-voided purchase history remains the cost falls
  to 0.
- D18.10: wallet origin FKs (`purchaseId`, `supplierPaymentId`) replace the old
  note-matching; void reversals are linked by FK, not note text.
- D18.8: reports exclude voided records — `salesReport`, `purchasesReport`,
  `stockReport` filter out reason `VOID` movements and voided origin FKs;
  `customersReport`, `suppliersReport`, `walletReport` exclude `VOID` wallet
  sources and voided origin FKs. Report totals stay read-only derivations.
- D18.9: status exposure — `Sale`, `Purchase`, `CreditPayment`,
  `SupplierPayment`, `StockMovement` now carry `voidInfo`
  (`status: ACTIVE | VOIDED`, `voidedAt`, `voidReason`) on findById/list/list
  paginated responses via `toXxxApi` mappers; `GET /api/stock/movements`
  maps through `toStockMovementApi`.
- Payments to voided sales are blocked (D18.4); `tests/helpers/db.ts`
  `reconcile()` is void-aware: voided origins excluded from D3/D4 + wallet
  ledger, original rows + VOID reversals cancel exactly.
- D18.11 hardening (post-review fix): `voidSale` and `createCustomerPayment`
  both lock the `sales` row with `SELECT ... FOR UPDATE` (shared helper
  `lib/locks.ts`) before reading void/linked-payment state, closing the
  void + payment race under READ COMMITTED (an active CreditPayment could
  otherwise be created on a sale being voided; the ledger invariants still held
  in that state, so the race was a semantic gap, not corruption).

**Verified**

- `tsc --noEmit` green; `npm run lint` green; `git diff --check` clean.
- `tests/integration/voids.test.ts` — 18 tests: sale/purchase/credit-payment/
  supplier-payment/stock-movement voids, reversal rows, D18.4/5/8/9, 404/409,
  insufficient-stock, double-void, report exclusion, status exposure.
- `tests/http/voids-http.test.ts` — 11 tests: OWNER-only 403 for CASHIER, 401
  unauthenticated, 400 malformed body, status exposure in GET/list responses,
  409 double-void, D18.8 reports over HTTP, isolated CORRECTION-movement void.
- Full gate passes: unit 173/173, integration 91/91, concurrency 6/6, HTTP
  error 12/12, HTTP bounds 11/11, HTTP smoke 15/15, auth 17/17, pagination
  32/32 (+ voids suites). `test:http:voids` added to `test:all`.
- `tests/concurrency/void-payment.test.ts` — F-08 D18.11 race: concurrent
  `voidSale` + linked `createCustomerPayment` (12× per run); exactly one wins,
  the loser rejects with the expected business rule, no payment ever lands on
  a voided sale, `reconcile()` clean. Proven to catch the bug: with the
  `FOR UPDATE` locks removed, the suite fails immediately (both succeed).
- D18.1–D18.11 recorded in `docs/business-decisions.md` (D18.11 documents the
  row-lock strategy and its verification).

## 2026-08-15 — Test-infra hardening: sign-in cold-start + leftover-server leak

- The spawned-dev-server HTTP suites intermittently failed with a Next.js 404
  HTML page (or 401) on the FIRST sign-in after server start: a POST to
  `/api/auth/sign-in/email` landing before Turbopack registers the route is
  answered by the dev proxy, never reaching the route handler.
- `tests/helpers/http.ts` `signIn()` now retries the POST itself on 404 until
  the route is registered (a GET probe is useless — better-auth delegates it,
  so it 404s forever). 404s served by the proxy never hit the handler, so the
  retry consumes no rate-limit quota.
- Second leak: a failed `beforeAll` left `server` undefined, so `afterAll`
  crashed in `stopServer` and the previous run's dev server was never cleaned
  up — the `.next/dev/lock` then blocked every later HTTP suite (snowball).
  `stopServer()` is now null-safe and, when the lock's pid is alive and its
  port matches the spawned server, kills that pid directly (Next can fork the
  lock-writing worker in a different process group than the supervisor) and
  unlinks the lock.
- Verified: the 3 HTTP suites (error-handling, rate-limit, security-headers)
  pass 3/3 consecutive runs; two full `npm run test:all` runs pass end-to-end
  with no leftover `next dev` processes and no stale `.next/dev/lock`;
  `tsc --noEmit`, `npm run lint`, `git diff --check` all clean.

---

## Milestone 19 — Security hardening: rate limiting, headers, id validation, OWNER race (F-08 / F-11 / P3 / P4) (15 Aug 2026)

**Shipped**

- **F-08 rate limiting** — `lib/rate-limit.ts`, process-local fixed-window:
  - `consumeAuthAttempt(req)` — keyed by client IP (`x-forwarded-for` left-most
    value, else `unknown`); default 20 / 15 min; throws `RateLimitError` (429).
    Wired in `app/api/auth/[...all]/route.ts` **only** on the sign-in paths
    (`/api/auth/sign-in/email`, `/api/auth/sign-in/username`); get-session and
    sign-out are deliberately unlimited.
  - `consumeApiRequest(userId, method)` — keyed by user id; **state-changing
    methods only** (POST/PUT/PATCH/DELETE); GET reads never limited; default
    300 / 60 s. Wired at the single authorization choke point in
    `requireUser` (`lib/auth/authorize.ts`), so every guarded route is covered.
  - All caps configurable via env (`ERP_RATE_LIMIT_AUTH_MAX`,
    `ERP_RATE_LIMIT_AUTH_WINDOW_MS`, `ERP_RATE_LIMIT_API_MAX`,
    `ERP_RATE_LIMIT_API_WINDOW_MS`), read at call time; defaults documented in
    `.env.example`. Deployment model documented in code + D19.1: process-local
    counters, exact under the single-process deployment, must become a shared
    store (Redis) if the backend ever scales horizontally.
  - `RateLimitError` (429) added to `lib/errors.ts`; rendered by the existing
    `toHttpResponse`.
- **F-11 security headers + no-CORS** — `next.config.ts` `headers()`:
  - Baseline on `/:path*`: `X-Content-Type-Options: nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin`,
    `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(),
    geolocation=(), payment=()`.
  - `/api/:path*` additionally: strict CSP `default-src 'none'; base-uri
    'none'; frame-ancestors 'none'` (safe for a pure JSON API) and
    `Cross-Origin-Resource-Policy: same-origin`.
  - CORS **deliberately disabled as policy** — no `Access-Control-Allow-*`
    header is ever emitted, so browsers enforce same-origin for reads and
    writes; combined with the app-level `assertSameOrigin` (D9.9) on
    state-changing requests, cross-origin access is rejected at both layers.
- **P3 route id validation** — `lib/validate.ts`: `assertUuid` (structural
  8-4-4-4-12 hex, not version-restricted — the all-zeros key stays a valid
  404) and `assertUserId` (UUID **or** Better Auth 32-char `[a-zA-Z0-9]`,
  since API-created users carry 32-char ids). Wired into all 14 `[id]` route
  files; malformed ids → `ValidationError` 400 instead of a Prisma-driven 500.
- **P4 last-OWNER race** — `lib/mutex.ts` `AsyncMutex`; `UserService` wraps
  `updateRole`/`deleteUser`/`banUser` in `ownerGuardMutex.runExclusive` so the
  D7 read-then-write guard (whose write Better Auth performs in its own
  transaction, outside Postgres row-lock reach) cannot be beaten by two
  concurrent demotions/bans/deletions. `unbanUser` unguarded (cannot reduce the
  OWNER count). Single-process limitation documented in code + D19.4.
- **P6 cleanup (M18 ride-along, verified no-op):** the duplicated
  `voidedIds` helper was already consolidated — `void.repository.ts` now
  exports `listVoidedTargetIds` and `report.repository.ts` imports it (the
  private copy was removed); the redundant
  `void_records_target_type_target_id_idx` index was already dropped by
  migration `20260815084442_drop_redundant_void_index` on both `erp_retail`
  and `erp_retail_test` (`pg_indexes` now shows only the pkey + unique
  constraint). No code change was needed for either.

**Verified**

- `tsc --noEmit` green; `npm run lint` green; `git diff --check` clean.
- `tests/unit/rate-limit.test.ts` (window semantics, state-changing-only API
  scope, env-config parsing), `tests/unit/validate.test.ts` (UUID + 32-char id
  acceptance, garbage rejection, field-name in message, all-zeros UUID stays
  valid), `tests/unit/mutex.test.ts` (mutual exclusion, ordering).
- `tests/http/rate-limit.test.ts` — dev server with low caps: sign-in blocked
  after N attempts with 429, API write requests blocked after N, **reads stay
  200** after a block, config read from env.
- `tests/http/security-headers.test.ts` — baseline on the scaffold page, strict
  CSP + CORP on `/api/*` and better-auth endpoints, no `access-control-*`
  header ever emitted.
- `tests/concurrency/last-owner.test.ts` — cross-demotions, cross-bans,
  cross-deletions by two OWNERs: exactly one succeeds, exactly one active OWNER
  remains; deletion scenario leaves exactly one user. Proven against the
  regression by temporarily bypassing the mutex.
- `tests/http/input-bounds.test.ts` — two new hostile-path cases: malformed
  entity id (`/api/products/not-a-uuid`) and malformed user id → 400, not 500;
  the suite's liveness check still passes.
- Full gate: **unit 189/189, integration 91/91, concurrency 9/9, HTTP
  (error-handling + rate-limit + security-headers) 17/17, HTTP bounds 13/13,
  HTTP smoke 15/15, auth 17/17, pagination 32/32, voids 11/11 — 394/394**,
  exit 0, no leftover `next dev` processes, no stale `.next/dev/lock`.
- D19.1–D19.4 recorded in `docs/business-decisions.md`; `.env.example`
  documents the rate-limit knobs; `docs/architecture-audit.md` re-audited at
  HEAD `c314953`.

## M20 — Data export (D20.1–D20.3) — COMPLETE — 15 Aug 2026

**What shipped**
Six read-only export endpoints, one per D7 report, at
`GET /api/exports/{sales,purchases,stock,customers,suppliers,wallet}` with
`format=csv|json` (default csv) and the same `from`/`to` report range params:

- `modules/exports/` — `export.types.ts`, `export.validation.ts`
  (`format` param), `export.definitions.ts` (report → CSV document layout),
  `csv.ts` (RFC-4180 encoder, UTF-8 BOM, CRLF, text-only formula-injection
  guard), `json.ts` (piecewise JSON encoder), `export.service.ts`
  (streaming body + `Content-Disposition`).
- Six route files under `app/api/exports/`, reusing `ReportService` +
  `PrismaReportRepository` verbatim. D20.3 reuses the D9.6 role matrix:
  sales/stock are OWNER+CASHIER; purchases/customers/suppliers/wallet are
  OWNER-only.

**Design decisions (D20.1–D20.3)**
An export is a pure serialization of the report payload — no own computation,
no DB access, no schema change. CSV = metadata block (report name + D10 range
echo) then one table per report section; numbers stay bare (so negative
balances survive), text cells with formula-trigger leading chars get an
injection guard. D20.2: full range, never truncated at the 50-row pagination
cap, bodies streamed chunk-per-row/element. D20.3: no separate export
permission matrix; exports are GET reads, so F-08 never rate-limits them.

**Verification**
- `tests/unit/exports.test.ts` (14): RFC-4180 quoting, BOM prefix, injection
  guard incl. bare negative money, CRLF rows, JSON byte-identical to
  `JSON.stringify`, document layout, `format` validation.
- `tests/http/exports-http.test.ts` (11) over a real dev server:
  content-type + `Content-Disposition` filenames, BOM bytes, CASHIER 200 on
  sales/stock and 403 on the four OWNER-only exports, unauthenticated 401,
  bad format 400, range echo in CSV metadata matches the JSON `range`,
  voided sale excluded (D18.8), JSON export ≡ `/api/reports/sales` payload,
  62-product stock export complete while `GET /api/products?limit=50` returns
  50 (D20.2), and a 12-request export burst never rate-limited (F-08).
- Full gate: `npm run test:all` — **unit 203 (incl. exports 14), integration 91,
  concurrency 9, HTTP 17, HTTP bounds 13, HTTP smoke 15, auth 17, pagination 32,
  voids 11, exports HTTP 11 — 419/419**, exit 0, no leftover dev
  servers, no stale lock. `npx tsc --noEmit` and `npm run lint` green.
- D20.1–D20.3 recorded in `docs/business-decisions.md`; README route table +
  export note updated.

## M21 — Responsive mobile-first frontend — PLANNED (kickoff package) — 15 Aug 2026

**Status: planning only — no frontend implementation yet.**

What was prepared (the M21 kickoff package):

- `docs/frontend-plan.md` — complete responsive information architecture
  (sitemap, per-breakpoint navigation model, D9.3 role matrix applied to the
  shell) and a page-by-page wireframe specification for desktop, tablet, and
  mobile (mobile-first): sign-in, home, fast sales entry (centerpiece), sales
  list/detail + void, products, stock movements + adjustment, customers +
  receive payment, suppliers + pay, purchases, reports hub + 6 report pages +
  exports, users, settings.
- D21.1–D21.8 recorded in `docs/business-decisions.md`: same-origin Next.js
  App Router frontend consuming only the existing `/api/*` endpoints (no new
  data plane, no CORS change, UI-page CSP added); mobile-first breakpoints
  (mobile <768 / tablet 768–1199 / desktop ≥1200) with bottom tab bar →
  icon rail → sidebar; touch targets ≥ 44 px; fast sales entry; responsive
  table → card → grid → table transformation rules; simple stock/customer/
  payment workflows; role-adaptive menu; explicit error/loading/empty states
  and double-submit prevention.

**PM scope resolutions (15 Aug 2026, recorded in `docs/frontend-plan.md` §14):**

1. **Wallet manual entries — deferred to backend backlog.** Wallet read-only
   in M21 (balance via `GET /api/reports/wallet`). No `POST /api/wallet`, no
   schema change.
2. **Customer-filtered sales — deferred to backend backlog.** M21 does not
   touch `GET /api/sales`. Customer detail = signed balance (D4) + payment
   history; no per-customer CREDIT-sale list.
3. **Low-stock alert — removed from M21.** No hardcoded threshold; products
   always show plain `stockQty`. Per-product reorder point recorded for the
   backend roadmap.
4. **Report date presets — approved, frontend-only.** Today (default) / 7d /
   30d / This month / Custom, computed shop-local from the report's echoed
   `range` (never browser timezone). Home "Today" tile uses the same
   shop-local day.
5. **Close of day — deferred entirely to backlog.** Home shows a live Today
   summary only; no day-close button, snapshot, or cash-count in M21.

Backlog (not M21): `POST /api/wallet`, `customerId` filter on sales,
per-product reorder/low-stock threshold, `POST /api/day-close` daily snapshot.

**Verification:** `npx tsc --noEmit`, `npm run lint`, `git diff --check` green;
backend gate untouched (419/419). No frontend code written.

## M21 — Frontend architecture proposal (D22) — 15 Aug 2026

**Status: architecture approved by PM — implementation not yet started.**

Proposal prepared against the actual repository (routes, wire shapes, auth,
`proxy.ts` matcher, CSP, deps) and recorded in `docs/business-decisions.md`
(D22.1–D22.7) and `docs/frontend-plan.md` §16:

- **Stack:** Next.js 16 App Router (RSC shell + minimal client islands),
  Tailwind v4, `better-auth/react`; new deps TanStack Query (server state),
  Zustand (POS cart only), React Hook Form + Zod, shadcn/ui (curated) +
  lucide-react + Sonner.
- **Not added:** Recharts (no charts in M21 — plan §2), `@tanstack/react-table`
  (semantic `<table>` for desktop), Playwright (deferred post-M21), Redux.
- **State separation:** TanStack Query (server) / Zustand (cart) / `useState`
  (local) / `searchParams` (filters, cursor, report range) / RHF+Zod (forms);
  backend remains authoritative for all business math.
- **Responsive:** mobile-first three-tier (bottom tab bar / icon rail /
  sidebar), never-shrink row→card→grid→table rules, touch targets ≥44 px,
  Devanagari font coverage, no hover-only interactions.
- **Testing:** Vitest unit (node) + component (jsdom + RTL + user-event) as a
  new `test:frontend` in the gate; Playwright deferred.
- **Discrepancies found & reported:** `proxy.ts` gates `/api/*` only (UI pages
  need their own RSC session gate); UI pages currently have no CSP (D21.1
  nonce CSP is a Phase A `next.config.ts` change); Geist font is latin-only
  (needs Devanagari coverage).

**PM decisions accepted 15 Aug 2026:** D1 no charts in M21 (backlog);
D2 semantic tables, defer TanStack Table; D3 defer Playwright to post-M21
hardening.

**Verification:** docs-only changes; no code/tests/config changed, so the
backend gate was not rerun (test-rule §8). `git diff --check` clean; working
tree has the D22 + §16 doc updates uncommitted.

---

## Current state (17 Aug 2026)

- **Done through M20 + M21 Phase A/B.1/B.2/C.1/C.2:** Products/Pricing, Sales,
  Purchasing, Suppliers + Supplier Payments, Customers + Credit Payments,
  Stock Adjustments, Reporting, and audit fixes F-01 through F-15, plus M18
  transaction void/correction (D18.1–D18.11), M19 security hardening
  (D19.1–D19.4), M20 data export (D20.1–D20.3). M21 frontend: Phase A
  foundation (shell, sign-in, D23 design language), Phase B.1 POS `/sales/new`
  (16 Aug), Phase B.2 sales list/detail/OWNER void (`a147d9a`, 17 Aug),
  Phase C.1 products & stock (`8a4cc99`, 17 Aug),
  Phase C.2 customers & payments (`3fd071e`, 17 Aug). Phase C complete.
- **Backend test gate:** `npm run test:all` — unit 203, integration 91,
  concurrency 9, HTTP 17, HTTP bounds 13, HTTP smoke 15, auth 17,
  pagination 32, voids 11, exports HTTP 11 = **419 tests, all green**.
- **Frontend test gate:** `npm run test:frontend` — 14 files, **106 tests,
  all green** (includes C.2 customer/payment tests).
- **PM review:** ERP-007, ERP-008, ERP-009 closed COMPLETE; M19, M20
  committed; M21 Phase A through C.2 committed. Documentation reconciliation
  pending.
- **Next:** PM review of C.2 documentation changes; then Phase D (suppliers,
  purchases, reports, users) per `docs/frontend-plan.md` §13.

## M21 — Phase A: frontend foundation (D22) — 16 Aug 2026

**Status: PM-approved (16 Aug 2026) and committed as the clean M21 frontend foundation. Phase B complete — B.1 POS (`/sales/new`) shipped 16 Aug 2026; B.2 sales list/detail/OWNER void shipped 17 Aug 2026 (`a147d9a`).**

PM visual/UX review of the live Vercel Preview passed (owner / Preview!2026).
Temporary preview access was revoked after the review; protection state
restored (`ssoProtection: all_except_custom_domains`, `gitForkProtection: true`,
no active bypass token).

Frontend-only milestone per the D21/D22 package. No backend API, Prisma schema,
or business-logic changes; the `/api/*` security headers and proxy API gate
(D9.8, `/api/auth/*` exemption) are untouched.

**Shipped**

- **Dependencies** (runtime): TanStack Query 5, Zustand 5, React Hook Form +
  Zod 4 (`@hookform/resolvers` zod subpath), shadcn/ui (curated) + `radix-ui`
  unified + lucide-react + Sonner + next-themes + cva/clsx/tailwind-merge +
  tw-animate-css. Dev: jsdom + Testing Library + jest-dom. npm `overrides`
  pin `@typeschema/{zod,core}` to `$zod` to clear the zod3-only peer conflict.
  `npm audit fix` applied (prisma 7.9.0→7.9.1, valibot 1.4.2); 3 high remain —
  sharp via next@16.2.11 libvips CVEs, fix needs next@16.3.1 (outside range).
- **shadcn init** (`-b radix -p nova`) → `components.json`, `lib/utils.ts`,
  rewritten `app/globals.css` (font stacks, `--breakpoint-tablet: 768px` /
  `--breakpoint-desktop: 1200px`, `@utility` pb-safe/pt-safe/min-touch/
  min-touch-desktop). UI components added: button, input, label, card,
  dropdown-menu, avatar, separator, badge, sonner, sheet. **`form` registry
  item is broken upstream** (empty radix-nova entry; classic has `files: null`)
  → `components/ui/form.tsx` written manually from the classic source, adapted
  to the unified `radix-ui` namespace (`Label.Root`, `Slot.Root`).
- **Typography**: `app/layout.tsx` + Geist/Geist_Mono with Noto Sans +
  Noto Sans Devanagari (latin + Devanagari coverage); `--font-noto-sans`,
  `--font-noto-devanagari` vars.
- **Auth**: `lib/auth-client.ts` (`createAuthClient` + username + admin
  plugins), `lib/auth/session.ts` (`getSession`/`requireSession`/`requireRole`,
  SessionUser, nullish-safe name/username, role default CASHIER). Sign-in page
  (public RSC redirect if session exists) + RHF/Zod form with inline server
  error (D21.8), password eye toggle (44 px target), double-submit guard,
  toast only on success → `push("/")` + refresh. Workspace route group
  `app/(workspace)/` gated by `requireSession()`.
- **Shell** (D21.2/D21.7): mobile <768 bottom tab bar (5 tabs, safe-area),
  tablet 768–1199 icon rail, desktop ≥1200 sidebar (240 px) — driven by
  `components/layout/nav-items.ts` (7 sections, OWNER-only Purchases/Users,
  More sheet role-filtered); sticky header + UserMenu (avatar initials,
  sign-out). `app/page.tsx` moved into the workspace group.
- **Data**: `lib/api/client.ts` (typed `api.get/post`, `ApiError`,
  `isAuthLostError` 401 / `isRateLimitedError` 429), `lib/api/query-keys.ts`,
  `lib/query-client.ts` (30 s stale, no window-focus refetch, retry 1);
  `stores/cart.ts` (Zustand POS cart, CREDIT reset keeps customer).
- **Formatting (Q4/D11)**: `lib/format/money.ts` — rupees are the wire unit,
  `formatRupees` (Intl en-IN `₹`), `formatRupeesFromPaisa` (/100),
  `formatSignedRupees` (D4 prepaid), compact k/L/Cr. `lib/format/dates.ts` —
  shop-local day/range from the report's echoed `range` (parseOffsetMinutes),
  `reportPresetRange` today/7d/30d/month/custom emitting naive YYYY-MM-DD.
  `lib/validate/sign-in.ts` mirrors the auth rules (password ≥ 8).
- **CSP (D21.1)**: `proxy.ts` now also serves a nonce-based UI-page CSP
  (`x-nonce` request header → Next auto-attaches to scripts; `strict-dynamic`,
  `style-src 'unsafe-inline'` for Radix inline styles + Sonner `<style>`,
  dev `unsafe-eval` + ws:). Static assets, image optimization, and prefetch
  requests excluded. `/api/*` keeps its strict `default-src 'none'` policy.
- **Tests**: `test:frontend` added to the gate (Vitest jsdom, `tests/frontend/`,
  excluded from the backend config). 6 suites / 45 tests: money, dates,
  sign-in validation, cart store, nav-items, sign-in form (RTL + user-event).

**Verified**

- `npx tsc --noEmit` green (after fixing: stale `.next` route types from the
  deleted `app/page.tsx` — regenerated via `npx next typegen`; `radix-ui`
  `Slot` = submodule namespace → `Slot.Root`; `FormControl` Slot id must land
  on the input, so the password eye-toggle wrapper moved *outside*
  `FormControl`; session `name`/`username` nullish fallbacks).
- `npm run lint` clean; `git diff --check` clean.
- `npm run test:frontend` — 45/45 green.
- Backend gate intentionally not rerun (frontend-only milestone; no backend
  files touched beyond the 4 previously-reported config changes).

**Notes / risks for Phase B**

- shadcn `form` component is registry-broken — manual file must be maintained.
- 3 high npm audit findings (sharp libvips via next 16.2.11) accepted until
  Next 16.3.x is adopted.
- `moreDestinations` in nav-items vs the inline role-filter in more-sheet are
  intentionally duplicated (small, self-contained) — revisit in Phase B if the
  More sheet gains sections.

### 2026-08-16 — pre-review fix: client bundle leaked the Prisma/pg graph (dev smoke)

First live render of `/sign-in` returned 500. Dev log showed the whole
`pg`/`@prisma` tree (`net`/`tls`/`dns`/`fs`/`util/types` + `node:module` chunk
error) being bundled into the **client** graph: `nav-items.ts` imported the
value `OWNER` from `lib/auth/authorize.ts`, which statically imports
`lib/prisma.ts` → `@prisma/adapter-pg`. Since `app-shell.tsx` is a client
component (uses `usePathname` for the header title), the entire auth/Prisma
graph was dragged into the browser bundle and failed to build.

**Fix (frontend-only, no behavior change):** extracted the role constants to a
new dependency-free `lib/auth/roles.ts` (`OWNER`/`CASHIER`/`Role`); the rest of
`lib/auth/authorize.ts` re-exports them unchanged, so every backend route import
still works. `nav-items.ts` now imports `OWNER`/`Role` from `./roles`. The other
layout components import `Role` via `import type` (erased at build — no runtime
dependency).

**Verified:** `npx tsc --noEmit`, `npm run lint`, `npm run test:frontend`
(45/45) green; `/sign-in` 200 with expected content; `/` 307 → `/sign-in` when
logged out; no new errors in the dev log (the recorded pg errors are all
pre-fix timestamps). Backend gate not rerun (no backend-affecting change).

### 2026-08-16 — currency locale corrected: Indian ₹ → Nepali NPR (रू)

The ERP is for Nepal, but the frontend money presentation used the Indian
rupee (₹ / INR / en-IN). Corrected to the Nepali rupee while keeping the D11
backend/domain money model and the paisa ↔ rupee wire contract untouched:

- `lib/constants.ts`: `CURRENCY_CODE` `INR → NPR`, `CURRENCY_LOCALE`
  `en-IN → ne-NP`, new `CURRENCY_SYMBOL = "रू"`.
- `lib/format/money.ts`: all formatters now render `रू` (e.g. "रू 12,340.50",
  "रू 1,23,456.50", "रू 1.5L"); `Intl.NumberFormat` pinned to
  `numberingSystem: "latn"` so the ne-NP locale emits Latin digits while
  keeping the South Asian lakh/crore grouping the shop uses.
- `components/layout/rail.tsx`: the tablet-rail brand mark `₹` → `CURRENCY_SYMBOL`.
- `app/layout.tsx` / `app/globals.css`: font-coverage comments updated to the
  Nepali rupee (Devanagari रू, covered by Noto Sans Devanagari).
- `tests/frontend/format/money.test.ts`: assertions updated to `रू`.

A sweep of the whole frontend (`app/`, `components/`, `lib/`, `stores/`,
`tests/frontend/`, `next.config.ts`, `proxy.ts`) confirms zero remaining
`₹` / `INR` / `en-IN` / India-specific currency references. Backend
`modules/**`, `lib/money.ts`, and backend tests untouched ("rupees" is the unit
name, not India-specific).

**Verified:** `npx tsc --noEmit`, `npm run lint`, `npm run test:frontend`
(45/45) green, `git diff --check` clean. Backend gate not rerun
(frontend-only, per review instruction).
### 2026-08-16 — Vercel Preview environment (deployment/build config, auth base URL, Neon DB)

Deployment infrastructure for a Vercel Preview environment, PM-approved.
No Prisma schema/migration/backend-logic changes.

**Shipped**

- `package.json`: added `"prebuild": "prisma generate"` so a clean Vercel
  checkout generates Prisma Client before `next build` (build/deploy config
  only; the generated client stays gitignored).
- `lib/auth/base-url.ts` + `lib/auth.ts`: Better Auth base URL now resolves
  dynamically instead of a hardcoded localhost. `resolveAuthBaseURL()` returns
  an explicit `BETTER_AUTH_URL` when set, otherwise a Better Auth
  `BaseURLConfig` (`protocol: "auto"`, `allowedHosts: [localhost, 127.0.0.1,
  *.vercel.app]`, fallback localhost). Verified against the installed
  `better-auth` source: host is derived per-request and validated against the
  allowlist (wildcard `*.vercel.app` supported), protocol auto-selects `https`
  off-loopback, and trusted origins are derived from the allowlist — origin
  checks are not weakened. `env` param typed `Record<string, string | undefined>`
  (Next 16 makes `NodeJS.ProcessEnv.NODE_ENV` required, which broke the test
  literals).
- `tests/unit/auth-base-url.test.ts`: focused F-10 tests (explicit URL wins,
  localhost fallback, wildcard preview coverage, never a hardcoded preview
  host).
- `.env.example`: documented the dynamic base URL behavior.
- Vercel Preview infra (CLI/API, no committed secrets):
  - Git repo `shishirg46/retail-erp` already connected to project `erp-retail`.
  - Dedicated Neon Postgres `erp-retail-preview-db` provisioned and connected
    to the project (Preview scope only).
  - Preview env vars: `DATABASE_URL` (+ Neon host/port/user/password vars),
    `BETTER_AUTH_SECRET` (Sensitive), `ERP_TIMEZONE=Asia/Kathmandu`.
    No Production/Development env vars exist.
  - `prisma migrate deploy` applied all 6 existing migrations to the Neon
    Preview DB after verifying `DATABASE_URL` points at the Neon host.
  - `scripts/seed-owner.mjs` seeded one demo OWNER login into the Preview DB
    (idempotent; verified host before seeding).

**Verified**

- `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` green
  (prebuild → prisma generate → next build), `npm run test:frontend` 45/45.
- End-to-end sign-in against the Neon Preview DB (local production build with
  Preview DB + strong secret): POST /api/auth/sign-in/username → 200, user
  `owner` role `OWNER`; session row persisted in Preview DB; GET
  /api/auth/get-session round-trip OK.
- Preview deployment Ready:
  `https://erp-retail-rfvvopbui-shishirg46s-projects.vercel.app`
  (behind Vercel SSO deployment protection).
- Caveat: the first `vercel deploy` of a fresh project auto-assigned to
  Production (no production env vars exist, so it is inert). Flagged to PM;
  not addressed (out of scope, pending PM decision).

## M21 — Phase A follow-up: design language, typography & color tokens (D23) — 16 Aug 2026

**Status: design language locked before Phase B screens. Phase B (pages) not started.**

PM direction before Phase B: move the generic Phase A shell (Geist + neutral
grey shadcn palette) to a restrained, professional ERP look — approved
typography (Plus Jakarta Sans + Noto Sans Devanagari) and a coherent color-token
system documented before/while building the first Phase B screen. Recorded as
D23 in `docs/business-decisions.md`; full reference in `docs/frontend-plan.md` §6.

**Shipped**

- **Typography (D23.1):** `app/layout.tsx` now loads Plus Jakarta Sans (Latin
  UI/brand) + Noto Sans Devanagari (Nepali data + rupee रू); Geist/Geist_Mono
  and the Noto Sans Latin fallback removed. `@theme` stacks in `globals.css`:
  `--font-sans`/`--font-heading` = Plus Jakarta Sans → Noto Sans Devanagari →
  system; `--font-nepali` = Noto Sans Devanagari; `--font-mono` = system
  `ui-monospace` stack (technical IDs only).
- **Color tokens (D23.2):** `globals.css` `:root` + `.dark` rewritten to the
  single-source token palette. One primary brand/action blue `#2869d9`
  (light) / `#5d87d7` (dark); cool-neutral surfaces (hue 260); semantic
  `--success`/`--warning`/`--destructive` pairs (+ `*-foreground`); neutral
  navigation with a subtle primary-tinted active state (`--sidebar-accent`).
  `@theme` gains `--color-success`, `--color-success-foreground`,
  `--color-warning`, `--color-warning-foreground` so Tailwind emits
  `bg-success` / `text-warning-foreground`, etc. All Phase A components render
  through existing token classes, so no component code changes were needed.
- **D23.2 primary adjustment (PM review):** PM requested `#3080f0`
  (hover `#2569d1`, tint `#eaf3ff`, fg `#ffffff`) but `#3080f0` fails WCAG AA
  (white 3.84:1, on-tint 3.43:1); PM approved the one-step-darker **`#2869d9`**
  (`oklch(0.5447 0.1844 260.6)`, hover `oklch(0.538 0.1746 259.2)`,
  tint `oklch(0.9609 0.0188 255.5)`, fg `oklch(1 0 0)`). `globals.css`
  `@theme` + `:root` + `.dark` updated (`--primary-hover` added; dark tokens
  otherwise unchanged, `--primary-hover` `oklch(0.69 0.12 262)`). Hover-opacity
  classes replaced with the explicit token: `hover:bg-primary/80` →
  `hover:bg-primary-hover` in `components/ui/button.tsx`,
  `components/ui/badge.tsx`, and `hover:bg-primary/90` in
  `app/(workspace)/page.tsx`. Docs (`frontend-plan.md` §6, D23.2/D23.3) updated
  with the final values and AA rationale.
- **Docs:** `frontend-plan.md` §6 — typography table, full OKLCh + hex token
  table for both themes, D23.3 usage rules (primary reserved for CTA/active
  nav/focus/links; cards neutral; semantic color for status only), and the
  WCAG AA contrast report. Plan §6 money examples corrected from `₹` to
  `रू` (leftover INR reference). `business-decisions.md` gains D23.1–D23.3.

**Verified**

- WCAG AA contrast computed from the OKLCh token values (all key text pairs
  ≥4.5:1; input/ring UI boundaries ≥3:1; light input border tuned to 3.16:1,
  dark warning/destructive pairs tuned to 6.47:1 / 4.66:1). After the D23.2
  primary adjustment, light pairs re-verified: white-on-primary 5.11:1,
  white-on-hover 5.22:1, primary-on-tint 4.56:1, sidebar-accent pair 4.56:1,
  ring-vs-bg 4.89:1; dark primary 5.56:1, hover 7.04:1 — all AA. Report in
  `frontend-plan.md` §6; tokens must be re-verified whenever they change.
- No INR/₹ references remain in `app/`, `components/`, `lib/`, `stores/`, or
  the plan (grep clean; the `adminRoles` "INR" match is a false positive).
- `npx tsc --noEmit` clean, `npm run lint` clean, `npm run test:frontend`
  45/45 green, `npm run build` green (next/font/google resolves Plus Jakarta
  Sans at build). Backend `test:all` not rerun (no backend change).

## M21 — Phase B.1: POS new-sale screen (`/sales/new`) — 16 Aug 2026

**Status: complete and accepted.** `/sales` list and `/sales/[id]` detail are the next frontend slice (Phase B.2), not a backend rewrite.

Frontend-only. Consumes only existing backend contracts: `GET /api/products`
(`?search&category&limit`, paginated `{ data, paging }` — D12), `GET
/api/customers` (`?search&limit`), `POST /api/sales` (rupees, `CASH|ECASH|
CREDIT`, CREDIT requires `customerId`). No backend, Prisma, or schema changes.

**Shipped**

- **Route:** `app/(workspace)/sales/new/page.tsx` (session-gated by the
  `(workspace)` layout; D9.3 — CASHIER and OWNER both sell). Renders the POS
  inside `<Suspense>`.
- **`components/sales/new-sale.tsx`** — product picker: debounced (250 ms)
  `useProductFilters` syncing `?search&category` via `router.replace`
  (searchParams = source of truth; TanStack Query keyed on the URL), category
  chips ("All" + derived from loaded products), Enter-in-search adds the first
  match, product grid 2-col mobile / 3-col desktop, sticky cart panel on
  desktop/tablet, and on mobile a fixed bottom cart bar (hidden when empty)
  opening a bottom `Sheet` with the same panel.
- **`components/sales/product-card.tsx`** — single-tap add tile; shows stock
  `stockQty` + cheapest active-tier hint (preview only — server recomputes
  totals/tiers at POST, D1/D22.2); stock-0 products disabled ("Out of stock").
- **`components/sales/cart-panel.tsx`** (`CartPanel` + `CartLineRow`) — quantity
  −/＋ steppers (44 px) + numeric input (blur/Enter commit, capped at
  `stockQty` else `MAX_ITEM_QUANTITY`), line removal, active-tier hint, payment
  type segmented control (`aria-pressed`), CREDIT opens `CustomerPicker`
  (required before save), preview total only (`formattedRupees` — never
  authoritative), Save with `submittingRef` double-submit guard +
  `mutation.isPending`, inline `[role=alert]` `ApiError.message`, success →
  `toast.success` + cart reset + `products.all`/`sales.all`/`reports.all`
  invalidation.
- **`components/sales/customer-picker.tsx`** — CREDIT customer search/select
  (50-item cap) with signed `balanceOwed` (`formatSignedRupees`), plus an
  inline **new-customer form** (`POST /api/customers`, OWNER + CASHIER) so a
  credit sale can proceed without a pre-existing customer (PM review, 16 Aug
  2026). Just-created customer is selected immediately (local pick fallback
  until the list refetch lands); name pre-fills from the current search.
- **Zustand cart extension** (`stores/cart.ts`) — `CartLine` gains optional
  `stockQty`/`tiers`; `addItem` accepts the whole line object (fixed a
  ReferenceError in the Phase A signature).
- **Validation** `lib/validate/sale.ts` — `newSaleSchema` mirrors
  `modules/sales/sale.validation.ts` bounds (`MAX_ITEM_QUANTITY` 100000,
  `MAX_ITEMS_PER_DOCUMENT` 100, empty-item / missing-pricing checks) with a
  CREDIT-requires-customer `superRefine`; `lib/api/types.ts` adds `Paginated<T>`.
- **Tier hints** `lib/format/tiers.ts` — `cheapestTier`/`activeTier`/`tierHint`
  (UX preview only, never authoritative).
- **Tests** — `tests/frontend/sales/new-sale.test.tsx` (7, `vi.hoisted` mocks
  for next/navigation + api client + sonner; includes the on-the-spot credit
  customer creation), `tests/frontend/validate/
  sale.test.ts` (7), `tests/frontend/format/tiers.test.ts` (5), cart store
  extended (8). Frontend suite now **65/65** (9 files).

**Verified**

- `npx tsc --noEmit` clean; `npm run lint` clean (final `useProductFilters`
  refactor removed the last `react-hooks/set-state-in-effect` +
  `react-hooks/refs` warnings); `git diff --check` clean (one pre-existing
  trailing space in the D23 entry removed); `npm run test:frontend` 65/65
  green. Backend `test:all` not rerun (frontend-only change).

**Notes**

- Working tree was not clean at start: uncommitted D23 design-language work
  (globals.css/layout fonts/colors, button/badge/page hovers, business-
  decisions D23, frontend-plan §6, implementation-log D23) sits on top of
  `257328f`; the Phase B.1 changes are layered on that uncommitted state and
  nothing was overwritten or committed.
- The accepted B.1 milestone is complete. Phase B.2 is now shipped and committed (`a147d9a`, 17 Aug 2026).

## M21 — Phase B.2: sales list, sale detail, and OWNER void flow — COMPLETE (17 Aug 2026)

**Status: shipped and committed (`a147d9a`).**

Frontend-only. Consumes only the existing backend contracts; no backend, Prisma,
or schema changes.

**Shipped**

- **`app/(workspace)/sales/page.tsx`** — sales list page. Cursor pagination
  (page size 10), payment-type filter chips (All / CASH / ECASH / CREDIT),
  loading skeleton, empty state, error state with retry. Each row shows date,
  payment type, customer or walk-in label, total, item count, and ACTIVE/VOIDED
  status badge. Tap navigates to detail. Mobile card layout; desktop table.
- **`app/(workspace)/sales/[id]/page.tsx`** — sale detail page. Displays sale
  metadata (date, payment type, total, status), customer or walk-in, line items
  with quantity/price/line total, and void information (reason, who, when) when
  present. Loading/error/retry states.
- **`components/sales/sales-list.tsx`** — reusable list component. Consumes
  `GET /api/sales` with `paymentType`, `limit`, and `cursor` params. Renders
  paginated sale rows with status badges and filter chips. TanStack Query with
  `saleKeys` for cache management.
- **`components/sales/sale-detail.tsx`** — detail component. Fetches
  `GET /api/sales/[id]` and renders the full sale record. OWNER-only void
  button visible only when `status === "ACTIVE"`. Void flow: confirmation UI,
  required reason, optional note, loading state, inline API error display,
  successful mutation invalidates `saleKeys.all` and `saleKeys.detail(id)`,
  detail refreshed after void.
- **`tests/frontend/sales/sales-b2.test.tsx`** — 7 new tests: loading state,
  populated list rendering, payment-type filtering, OWNER vs CASHIER void
  visibility, void form confirmation and reason validation, void request with
  success path, and API error propagation.

**API contracts consumed (unchanged)**

- `GET /api/sales` — list sales with cursor pagination and `paymentType` filter
- `GET /api/sales/[id]` — fetch one sale with items and void info
- `POST /api/sales/[id]/void` — OWNER-only void with `reason` and optional `note`

**Required backend work for B.2**

- None. The existing sales APIs and response shapes were sufficient.

**Verified**

- `npx tsc --noEmit` clean; `npm run lint` clean; `git diff --check` clean.
- `npm run test:frontend` — 72/72 green (10 test files, 7 new in B.2).
- Backend gate not rerun (frontend-only change).
- Commit: `a147d9a` — `feat(erp): add sales list, detail, and OWNER void flow`

## M21 — Phase C.1: products & stock frontend — COMPLETE (17 Aug 2026)

**Status: shipped and committed (`8a4cc99`).**

Frontend-only. Consumes only the existing backend contracts; no backend, Prisma,
or schema changes.

**Shipped**

- **5 routes:** `app/(workspace)/products/page.tsx` (products list),
  `app/(workspace)/products/[id]/page.tsx` (product detail),
  `app/(workspace)/products/new/page.tsx` (new product, OWNER-only),
  `app/(workspace)/stock/movements/page.tsx` (stock movements),
  `app/(workspace)/stock/adjust/page.tsx` (stock adjustment).
- **5 components:**
  - `components/products/products-list.tsx` — search input, category chip
    filter, cursor pagination (page size 10), loading/empty/error states,
    product cards with name/unit/price/cost/stock/category, "New product"
    button OWNER-only, link to detail.
  - `components/products/product-detail.tsx` — product info card (name, unit,
    current price, cost price, stock, category), price tiers table, recent
    stock movements with `+qty`/`−qty` per reason, link to full movements
    filtered by productId.
  - `components/products/product-form.tsx` — create form: name, unit select
    (SUPPORTED_UNITS), cost price, current price, category, dynamic price tiers
    (add/remove rows, `minQty` + `price`), pcs fractional `minQty` guard,
    inline server error display, OWNER-only role gate.
  - `components/stock/stock-movements-list.tsx` — reason filter chips
    (All/PURCHASE/SALE/DAMAGE/CORRECTION), cursor pagination (page size 20),
    movement cards with reason badge, date, qty change (green/red), note,
    void status badge, loading/empty/error states.
  - `components/stock/stock-adjust-form.tsx` — product selector (loads all
    products, shows current stock after selection), DAMAGE/CORRECTION reason
    selector, quantity input with unit-aware step, optional note, validation
    (positive qty, max 1000), inline server error display, success → redirect
    to movements.
- **`lib/api/query-keys.ts`** — added `stock.movements` key factory; extended
  `products.list` to include `cursor` parameter.
- **14 new frontend tests** across 2 files:
  - `tests/frontend/products/products-c1.test.tsx` (10) — ProductsList
    (loading/empty/error, search/filter/pagination, detail link, OWNER
    new-product button), ProductDetail (info/tiers/movements, loading/error),
    ProductForm (OWNER gate, submit + navigation, server error).
  - `tests/frontend/stock/stock-c1.test.tsx` (4) — StockMovementsList
    (loading/empty/error, reason filtering), StockAdjustForm (server error on
    failed adjustment, successful adjustment with navigation).

**API contracts consumed (all existing, unchanged)**

- `GET /api/products?search=&category=&cursor=` — paginated product list
- `GET /api/products/[id]` — product detail with price tiers
- `POST /api/products` — create product (OWNER-only)
- `GET /api/stock/movements?reason=&productId=&cursor=` — paginated stock
  movements
- `POST /api/stock/adjustments` — stock adjustment (DAMAGE/CORRECTION)

**Required backend work**

- None. The existing product and stock APIs were sufficient.

**Verified**

- `npx tsc --noEmit` clean; `npm run lint` clean; `git diff --check` clean.
- `npm run test:frontend` — 85/85 green (12 test files, 14 new in C.1).
- Backend gate not rerun (frontend-only change).
- Commit: `8a4cc99` — `feat(erp): add products and stock frontend`

## M21 — Phase C.2: customers & payments frontend — COMPLETE (17 Aug 2026)

**Status: shipped and committed (`3fd071e`).**

Frontend-only. Consumes only the existing backend contracts; no backend, Prisma,
or schema changes.

**Shipped**

- **4 routes:** `app/(workspace)/customers/page.tsx` (customers list),
  `app/(workspace)/customers/new/page.tsx` (new customer),
  `app/(workspace)/customers/[id]/page.tsx` (customer detail),
  `app/(workspace)/customers/[id]/pay/page.tsx` (receive payment).
- **5 components:**
  - `components/customers/customers-list.tsx` — search input, cursor pagination
    (page size 10), loading/empty/error states, customer cards with name/contact,
    signed `balanceOwed` (red > 0 / green < 0), "Receive payment" and "View"
    action buttons per card.
  - `components/customers/customer-detail.tsx` — customer info card (name,
    contact), signed balance card (D4 color semantics), "Receive payment" and
    "Sale" action buttons, payment history section.
  - `components/customers/customer-form.tsx` — create form: name (required),
    contact (optional), inline server error display, success → invalidate
    customers → navigate to list.
  - `components/customers/customer-pay-form.tsx` — amount input (positive
    number, MAX_AMOUNT cap), customer balance display, optional sale linkage
    picker (fetches CREDIT sales, best-effort — no per-customer filter),
    success → invalidate payments + customers → navigate to detail.
  - `components/customers/payment-history.tsx` — paginated payment list with
    status badges (ACTIVE/VOIDED), void reason display, OWNER-only void flow:
    toggle confirmation form with required reason, inline error display,
    success → invalidate payments + customers.
- **`lib/api/query-keys.ts`** — added `cursor` to `customers.list`; added
  `customerPayments.all` and `customerPayments.list(customerId?, cursor?)`.
- **`lib/validate/customer.ts`** — client-side Zod schemas: `createCustomerSchema`
  (name, contact), `createCustomerPaymentSchema` (amount, optional saleId),
  `voidCustomerPaymentSchema` (reason, optional note).
- **21 new frontend tests** across 2 files:
  - `tests/frontend/customers/customers-c2.test.tsx` (10) — CustomersList
    (loading/empty/error, balance display, detail navigation), CustomerDetail
    (info/balance rendering, loading/error), CustomerForm (submit + navigation,
    server error), CustomerPayForm (submit + navigation, amount validation error).
  - `tests/frontend/validate/customer.test.ts` (11) — createCustomerSchema
    (empty/whitespace name, valid with/without contact), createCustomerPaymentSchema
    (zero/negative/positive amounts, optional saleId), voidCustomerPaymentSchema
    (empty/valid reason, optional note).

**API contracts consumed (all existing, unchanged)**

- `GET /api/customers?search=&cursor=&limit=` — paginated customer list (D12)
- `POST /api/customers` — create customer (name, optional contact)
- `GET /api/customers/[id]` — customer detail with signed `balanceOwed` (D4)
- `GET /api/customer-payments?customerId=&limit=` — paginated payment history
- `POST /api/customer-payments` — receive payment (`customerId`, `amount`, optional `saleId`, D5)
- `POST /api/customer-payments/[id]/void` — OWNER-only payment void with `reason` (D18)
- `GET /api/sales?paymentType=CREDIT&limit=` — best-effort sale linkage picker (no `customerId` filter — Q2 deferred)

**Required backend work**

- None. The existing customer and customer-payment APIs were sufficient.

**Scope deviations**

- Components that do not use `role` (CustomersList, CustomerForm, CustomerPayForm)
  have the `role` prop removed to avoid ESLint unused-prop warnings. Only
  CustomerDetail and PaymentHistory receive `role` (for OWNER-only void visibility).
  This follows the same pattern as StockAdjustPage.
- `saleId` linkage is best-effort: `GET /api/sales` has no `customerId` filter
  (Q2 deferred), so the form shows recent CREDIT sales for optional linking.

**Verified**

- `npx tsc --noEmit` clean; `npm run lint` clean; `git diff --check` clean.
- `npm run test:frontend` — 106/106 green (14 test files, 21 new in C.2).
- Backend gate not rerun (frontend-only change).
- Commit: `3fd071e` — `feat(erp): add customer and payment frontend flows`

## 2026-08-16 — Dev-only LAN Better Auth trusted-origin exception (D24) + LAN mobile verification

**Status: LAN mobile test successful end-to-end from the phone.**

**Context.** The LAN mobile test (phone at `http://192.168.1.123:3000`, dev
server `next dev -- --hostname 0.0.0.0`) hit Better Auth's **internal** origin
check: `POST /api/auth/sign-out` → `403 Invalid origin` on any cookie-carrying
state-changing request. Root cause: `trustedOrigins` derived from the base-URL
allowlist carries no port and `matchesOriginPattern` requires an exact origin,
so the LAN origin never matched. Sign-in passed because it had no session cookie
yet. Recorded as D24 in `docs/business-decisions.md`.

**Shipped**

- `lib/auth/base-url.ts`: `DEV_LAN_TRUSTED_ORIGINS = ["http://192.168.1.123:*"]`
  + pure helper `devLanTrustedOrigins(env)` returning the list only when
  `env.NODE_ENV === "development"`, else `[]`.
- `lib/auth.ts`: `trustedOrigins: devLanTrustedOrigins()` — host-pinned,
  port-wildcarded, development-only. In production the option is the empty list,
  so the strict check is untouched; the app-level D9.9 gate (`assertSameOrigin`)
  is unchanged.
- `tests/unit/auth-config.test.ts`: 2 new dev-only gate tests (`development` →
  the LAN entry; `production`/missing `NODE_ENV` → `[]`).

**Verified**

- Live dev server (auto-reloaded on edit): sign-out with a session cookie +
  `Origin: http://192.168.1.123:3000` → `200 {"success":true}` (was 403);
  same request with `Origin: http://evil.example` → `403 Invalid origin`
  (strictness preserved).
- `npx tsc --noEmit` clean; `npm run lint` clean; unit suites
  `auth-config` 12/12 + `sign-in-get-guard` 4/4; `npm run test:frontend` 66/66.
- Backend `test:all` not rerun (no business-logic change; the origin-check path
  was exercised live).
- **LAN mobile verification (phone, `http://192.168.1.123:3000`):** sign-in ✓,
  workspace ✓, products ✓, `/sales/new` ✓, sign-out ✓, credential GET leak
  fixed ✓ (form `method="post"` + proxy 307 credential-GET guard + Next
  `allowedDevOrigins`).
