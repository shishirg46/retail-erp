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

## Current state (13 Aug 2026)

- **Done:** Products/Pricing, Sales, Purchasing, Suppliers + Supplier Payments,
  Customers + Credit Payments, Stock Adjustments, Reporting. All green on
  `tsc --noEmit` and `eslint`.
- **Test data:** Rice stock 13, Oil 10, Biscuits 30; Kathmandu Wholesale balance
  0; customers Ramesh −5, Sita −100 (prepaid); wallet −4235; credit payments 405.
- **Postman:** `postman/Retail-ERP.postman_collection.json` — 58 requests,
  9 folders (Products, Suppliers, Purchases, Supplier Payments, Stock
  Adjustments, Customers, Customer Payments & Credit Lifecycle, Sales — Tier
  Pricing & Payment Types, Reports).
- **Next:** full ERP architecture audit before adding more features.
