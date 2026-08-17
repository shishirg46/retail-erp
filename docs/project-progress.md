# Retail ERP — Project Progress

SINGLE HIGH-LEVEL PROGRESS/MILESTONE TRACKER for the Retail ERP project.
Companion files:

- [`business-decisions.md`](business-decisions.md) — WHY / business rules (D1–D20)
- [`implementation-log.md`](implementation-log.md) — detailed technical history

---

## 1. Project Overview

A production-style Retail ERP built for a small Nepali retail shop. It covers
counter sales (CASH / ECASH / CREDIT), purchasing from wholesale suppliers,
customer credit with prepaid behavior, an auditable stock ledger, and a
read-only reporting layer.

- **Purpose:** run the shop's money, stock, and party-ledger bookkeeping on one
  consistent ledger instead of paper/mental records.
- **Business areas covered:** products & tier pricing, sales, purchasing,
  suppliers & supplier payments, customers & credit payments, wallet (cash box),
  stock, reporting.
- **Architecture approach:** strict **Route → Service → Repository → Prisma**
  layering. Routes are thin; services own business rules with one
  `$transaction` per multi-step operation; repositories own persistence and
  convert Decimal → number at the boundary. Reports are read-only derivations
  over the transactional tables (no stored report totals).
- **Tech stack (from the repository):** Next.js (App Router) API routes,
  TypeScript (strict, `tsc --noEmit` green), PostgreSQL, Prisma ORM (`PrismaPg`
  adapter, generated client in `generated/prisma`), Tailwind CSS (scaffold
  only). No UI beyond the API surface — the M21 frontend is planned
  (see `docs/frontend-plan.md`) but not yet implemented.

## 2. Current Overall Status

| Area | Status |
| ---- | ------ |
| Core transactional backend | COMPLETE |
| Financial architecture (wallet, balances) | COMPLETE |
| Inventory architecture (stock ledger) | COMPLETE |
| Reporting | COMPLETE |
| Architecture audit | COMPLETE — see [`docs/architecture-audit.md`](architecture-audit.md) |
| Audit fix — F-02 stock concurrency | COMPLETE (Milestone 7) — atomic conditional decrement for SALE + DAMAGE; concurrency regression suite |
| Audit fix — F-01 product validation | COMPLETE (Milestone 8) — `product.validation.ts` wired into `POST /api/products`; invalid payloads → 400 |
| Audit fix — F-03 error privacy | COMPLETE (Milestone 9) — generic 500 `{ "message": "Internal Server Error" }`, no raw message/path/DB/host leakage; server-side logging; unit + HTTP suites |
| Audit fix — F-04 input upper bounds | COMPLETE (Milestone 10) — `lib/bounds.ts` caps (`MAX_ITEM_QUANTITY`, `MAX_ITEMS_PER_DOCUMENT`, `MAX_AMOUNT`) enforced in all six validators; over-limit → 400 before allocation; unit + HTTP suites |
| Audit fix — F-15 regression suite | COMPLETE (Milestone 11) — full D1–D7 automated gate (`npm run test:all`, 17 suites / 197 assertions) against `erp_retail_test` only; dev DB proven byte-identical before/after. **Standardized on Vitest (Milestone 12)** — single runner, same 197 tests, exit 0. **CLOSED (PM-approved) — ERP-005** |
| Audit fix — F-05 DB hardening | COMPLETE (Milestone 13) — 17 CHECK constraints + 9 report indexes (migration `20260814034336_db_hardening_f05`); pre-migration validator green on both DBs; `tests/integration/db-hardening.test.ts` 24/24 (constraints/indexes exist, raw-SQL rejections, signed semantics preserved). Gate now 18 suites / 221 tests. **CLOSED (PM-approved) — ERP-006** |
| Audit fix — F-10 auth & roles | COMPLETE (Milestone 14) — Better Auth (local username+password, no sign-up), OWNER/CASHIER role matrix (D9.3), every ERP route guarded, OWNER user management; `app/api/users`, `modules/users/`, seed script. Gate now 21 suites / 259 tests. Evidence on ERP-007, left open for PM review |
| Audit fix — F-06/F-09 money & timezone | COMPLETE (Milestone 15) — D11 integer-paisa domain money (`lib/money.ts`; validators/ services/repositories/routes converted, rupees in/out at the API unchanged, Postgres DECIMAL rupees unchanged — no migration) + D10 shop-local timezone (`lib/timezone.ts`, `ERP_TIMEZONE`, default `Asia/Kathmandu`; shop-local naive report params, offset-string range echo). Robustness ride-along: `lib/auth/session-cookie.ts` shared cookie gate + `requireUser` cookie short-circuit. Gate now 23 test files / 283 tests. Evidence on ERP-008, left open for PM review |
| Audit fix — F-07 pagination/search/filtering | COMPLETE (Milestone 16) — D12 cursor-based pagination on all 8 list endpoints; backward-compatible (no params → raw array, any param → `{ data, paging }` envelope); default 50, max 500; `search`, `paymentType`, `category`, `supplierId`, `customerId`, `productId`, `reason` filters; `lib/pagination.ts` shared library; 23 unit + 32 HTTP tests. Gate now 25 test files / 338 tests |
| Transaction void/correction (F-07 remaining) | COMPLETE (Milestone 18, ERP-009) — 5 OWNER-only void endpoints, immutable originals + offsetting reversal rows, unique `(targetType, targetId)` + `SELECT ... FOR UPDATE` race closure, reports exclude voided records, void status exposed on all transaction APIs. D18.1–D18.11 recorded. Gate now 394 tests |
| Security hardening (F-08/F-11/P3/P4) | COMPLETE (Milestone 19) — process-local rate limiting (auth attempts per IP, state-changing API requests per user; 429); baseline headers + strict CSP + CORP with no-CORS as policy; route id format validation (`assertUuid`/`assertUserId` → 400); last-active-OWNER race closed with an async mutex. D19.1–D19.4 recorded |
| Data export (M20) | COMPLETE (Milestone 20) — six read-only export endpoints (`/api/exports/*`) serializing the D7 reports as Excel-ready CSV (UTF-8 BOM, RFC-4180, injection-guarded) or JSON; full range, streamed, never truncated at the 50-row pagination cap; D9.6 role matrix reused (CASHIER: sales + stock only). D20.1–D20.3 recorded |
| Production readiness | MOSTLY COMPLETE — F-01…F-15 audit fixes all implemented (F-10 ERP-007, F-06/F-09 ERP-008, M18 ERP-009, M19, M20 all PM-reviewed COMPLETE); remaining: deployment, backups/observability, and load testing |
| Frontend (M21) — Phase A foundation | COMPLETE (16 Aug 2026) — deps + shadcn/ui + CSP + shell + sign-in + utilities + cart store + frontend test gate built and verified (tsc/lint/test:frontend 45/45 green) + D23 design language (typography/color tokens). **B.1 POS `/sales/new` is complete and accepted.** **B.2 sales list (`/sales`), sale detail (`/sales/[id]`), and OWNER void flow is complete and committed (`a147d9a`, 17 Aug 2026).** **C.1 products & stock frontend complete and committed (`8a4cc99`, 17 Aug 2026).** Next planned frontend slice: Phase C.2 — customers & payments. |

Evidence:

- **Branch:** `main`
- **Latest commit:** `8a4cc99` (C.1 products & stock frontend) on top of
  B.2 `a147d9a`, B.1 `3a05289`, and D25 `378dd6a`.
- **Milestone/feature commits:** verifiable via `git log --oneline -4`.
- **Working tree:** 3 documentation files modified but unstaged
  (`docs/frontend-plan.md`, `docs/implementation-log.md`,
  `docs/project-progress.md`) — pending a documentation milestone commit.
- **Typecheck / lint:** currently pass — `npx tsc --noEmit` OK, `npm run lint`
  OK, `git diff --check` clean.
- **Test gate:** 36 backend test files / 419 tests (`npm run test:all` green)
  — unit 203 (incl. exports unit 14), integration 91, concurrency 9, HTTP 17
  (error-handling + rate-limit + security-headers), HTTP bounds 13, HTTP smoke
  15, auth 17, pagination 32, voids 11, exports HTTP 11. No leftover `next dev`
  processes, no stale `.next/dev/lock`. Frontend gate: 10 test files / 72 tests
  (`npm run test:frontend` green).

## 3. Completed Milestones

Chronological order. Status derived from the repository (all modules present and
verified live).

| # | Phase | Feature | Status | Main Components | Verification |
| - | ----- | ------- | ------ | --------------- | ------------ |
| 1 | Products | Product & tier pricing | COMPLETE | `modules/products/`, `app/api/products/` | Min-cost bundle pricing (`calculatePrice`) matches brute force; create/list/get verified |
| 2 | Sales | Sales (CASH / ECASH / CREDIT) | COMPLETE | `modules/sales/`, `app/api/sales/` | Wallet deposit, customer balance, signed stock movement all atomic (D1); CREDIT sale without customer → 400 |
| 3 | Financial | Wallet ledger | COMPLETE | `modules/wallet/` | Balance invariant `wallet == ΣDEPOSIT − ΣWITHDRAWAL` holds (−4235 at last check) |
| 4 | Purchasing | Suppliers | COMPLETE | `modules/suppliers/`, `app/api/suppliers/` | Create/list/get verified; balance tracking |
| 5 | Purchasing | Purchasing (CASH / CREDIT) | COMPLETE | `modules/purchases/`, `app/api/purchases/` | CASH debits wallet immediately (D3); CREDIT raises supplier balance; `costPrice` = latest cost (D2); migration `20260813050516` |
| 6 | Purchasing | Supplier Payments | COMPLETE | `modules/supplier-payments/`, `app/api/supplier-payments/` | Reduces balance + debits wallet; partial/full payments |
| 7 | Customers | Customers | COMPLETE | `modules/customers/`, `app/api/customers/` | Create/list/get verified |
| 8 | Customers | Customer Credit / Customer Payments | COMPLETE | `modules/customer-payments/`, `app/api/customer-payments/` | Signed balance prepaid lifecycle (D4); saleId linkage checks (D5) |
| 9 | Inventory | Stock Adjustments | COMPLETE | `modules/stock/`, `app/api/stock/adjustments|movements` | DAMAGE / CORRECTION semantics (D6); per-product `stockQty == Σ movements`; negative-results rejected |
| 10 | Reporting | Read-only reporting | COMPLETE | `modules/reports/`, `app/api/reports/` | All 6 reports match raw SQL; read-only proven (D7) |
| 11 | Documentation | Business Decisions & Logs | COMPLETE | `docs/business-decisions.md`, `docs/implementation-log.md`, `README.md`, `AGENTS.md` | D1–D7 recorded; milestone log current |
| 12 | API verification | Postman collection | COMPLETE | `postman/Retail-ERP.postman_collection.json` | 58 requests / 9 folders covering success + failure paths |
| 13 | Audit Fix | F-02 stock concurrency hardening | COMPLETE | `modules/products/product.repository.ts` (`reserveStock`), `modules/sales/sale.service.ts`, `modules/stock/stock.service.ts`, `tests/concurrency/stock.ts` | Atomic conditional decrement for SALE + DAMAGE; concurrency suite (5 scenarios) + 12 HTTP regression checks all pass; dev DB untouched |
| 14 | Audit Fix | F-01 product validation | COMPLETE | `modules/products/product.validation.ts`, `app/api/products/route.ts`, `tests/unit/product.validation.ts` | `POST /api/products` validates before persist; invalid payloads → 400; unit tests 30/30 + 13 HTTP checks pass; dev DB untouched |
| 15 | Audit Fix | F-03 error privacy (sanitized 500s) | COMPLETE | `lib/response.ts`, `tests/unit/error-response.ts`, `tests/http/error-handling.ts` | Generic 500 for all non-AppError failures (message/paths/DB/host/port never leaked), original error logged server-side; unit 11/11 + HTTP 12/12 incl. unreachable-DB leak-canary proof; F-01/F-02 regressions re-run green; dev DB untouched |
| 16 | Audit Fix | F-07 pagination/search/filtering (D12) | COMPLETE | `lib/pagination.ts`, 8 list endpoints, 8 repositories | Cursor-based pagination + search/filters; 23 unit + 32 HTTP tests; backward compatible |
| 18 | Audit Fix | Transaction void/correction (F-07 remaining, ERP-009) | COMPLETE | `modules/voids/`, 5 void endpoints, `lib/locks.ts`, VoidRecord model | D18.1–D18.11; immutable originals + reversal rows; FOR UPDATE race closure; 18 integration + 11 HTTP + concurrency race tests |
| 19 | Audit Fix | Security hardening (F-08/F-11/P3/P4) | COMPLETE | `lib/rate-limit.ts`, `lib/validate.ts`, `lib/mutex.ts`, `next.config.ts`, `lib/auth/authorize.ts` | Rate limits (auth per IP / API writes per user), headers + strict CSP + no-CORS, id validation, last-OWNER mutex; D19.1–D19.4; 394-test gate green |
| 20 | Export | Data export (D20.1–D20.3) | COMPLETE | `modules/exports/`, `app/api/exports/` | Six read-only `/api/exports/*` endpoints serializing the D7 reports as Excel-ready CSV (UTF-8 BOM, RFC-4180, injection-guarded) or JSON; streamed, full-range (never capped at 50); D9.6 roles reused; JSON ≡ report endpoint; 14 unit + 11 HTTP tests; 419-test gate green |
| 21 | Frontend | Responsive mobile-first UI (M21) | IN PROGRESS — Phase A COMPLETE + D23 design language; Phase B.1 POS `/sales/new` shipped (16 Aug); Phase B.2 sales list/detail/OWNER void shipped (`a147d9a`, 17 Aug); Phase C.1 products & stock shipped (`8a4cc99`, 17 Aug) | `app/(workspace)/`, `app/sign-in/`, `components/layout/`, `components/ui/` (shadcn), `components/sales/` (POS + list + detail), `components/products/` (list + detail + form), `components/stock/` (movements list + adjust form), `lib/format/`, `lib/auth/session.ts`, `lib/api/`, `lib/validate/`, `stores/cart.ts`, `proxy.ts` (UI nonce CSP), `tests/frontend/` | Phase A: deps + shadcn/ui (button/input/label/card/dropdown-menu/avatar/separator/badge/sonner/sheet/form) + mobile shell (tab bar/rail/sidebar) + sign-in + workspace auth gate + session/query/cart + money/dates/validation utils + UI nonce CSP; D23 typography/color tokens; B.1 `/sales/new` POS (search/category chips, product grid, cart sheet + sticky panel, CASH/ECASH/CREDIT gate, preview total only — server authoritative, double-submit guard); B.2 `/sales` list (cursor pagination, payment-type filter, status badges, loading/empty/error) + `/sales/[id]` detail (items, metadata, void info) + OWNER void flow (confirm, reason, API error, invalidation); C.1 `/products` list (search, category filter, pagination) + `/products/[id]` detail (info, price tiers, recent movements) + `/products/new` (OWNER-only, dynamic price tiers, pcs fractional guard) + `/stock/movements` (reason filter, pagination) + `/stock/adjust` (DAMAGE/CORRECTION, current stock display); `npx tsc --noEmit`, `npm run lint`, `git diff --check`, `npm run test:frontend` (85/85) all green; Phase C.2 (customers & payments) next |

## 4. Business Decisions Locked

From [`docs/business-decisions.md`](business-decisions.md) — exact decisions as
recorded, not reinterpreted.

| ID | Decision | Status |
| -- | -------- | ------ |
| D1 | `SaleItem.pricePerUnit` is an effective (informational) unit price; `Sale.total` is authoritative and must never be recomputed from current price | Locked — implemented |
| D2 | `Product.costPrice` is the current/latest reference cost (updated on purchase); `PurchaseItem.costPerUnit` is immutable historical cost. NOT inventory valuation / exact COGS — costing method is a future decision | Locked — implemented |
| D3 | Cash purchases must not inflate the wallet ledger: CASH purchase → immediate wallet `WITHDRAWAL/SUPPLIER_PAYMENT`; CREDIT → `Supplier.balanceOwed` only | Locked — implemented |
| D4 | Customer overpayment becomes prepaid credit (negative `balanceOwed` consumed by later CREDIT sales) | Locked — implemented |
| D5 | Optional `saleId` on customer payments — must exist (404), belong to the customer (400), be a CREDIT sale (400); no amount-matching | Locked — implemented |
| D6 | Stock adjustment semantics: DAMAGE quantity = amount ruined (−delta); CORRECTION quantity = desired final level; results < 0 rejected (409); baseline invariant `Product.stockQty == Σ movements` (products start at 0, opening stock via CORRECTION) | Locked — implemented |
| D7 | Reporting is a read-only derivation layer over transactional tables; never store report totals; no COGS / valuation / profit until a costing method is decided; inclusive `from ≤ date ≤ to` filtering | Locked — implemented |
| D9 | Authentication & roles (F-10): Better Auth (local username+password, no OAuth/MFA/sign-up); exactly two roles OWNER/CASHIER; permission matrix D9.3 (CASHIER = sales, customers view/create, customer payments, stock adjustments, stock movements, sales+stock reports); coarse proxy gate + authoritative DB-backed check (D9.8); same-origin enforcement on state-changing requests (D9.9); derived internal email `<username>@erp.local` never exposed (D9.10); reset-password revokes sessions (D9.5) | Locked — implemented |
| D10 | Shop-local timezone (F-09): `ERP_TIMEZONE` env (default `Asia/Kathmandu`, read at runtime — no schema change); naive `YYYY-MM-DD` report params interpreted as shop-local wall clock via Intl-offset technique; explicit-zone ISO strings parse as-is; report `range` echo is a shop-local offset string, never `.toISOString()`; impossible dates rejected 400 | Locked — implemented |
| D11 | Integer-paisa domain money (F-06): all app-domain money arithmetic in whole paisa; validators convert rupees→paisa once (round-half-up, exactly once); repositories read/write rupees `DECIMAL` via `paisaFromDecimal`/`paisaToRupees` (no migration); routes return rupees via `to*Api` mappers; API/report JSON shape and denomination unchanged; caps `MAX_AMOUNT`/`MAX_ITEM_QUANTITY`/`MAX_ITEMS_PER_DOCUMENT` preserved + new `MAX_AMOUNT_PAISA` | Locked — implemented |
| D12 | Cursor-based pagination, search, and filtering (F-07): optional cursor params on all 8 list endpoints; backward-compatible (no params → raw array, any param → `{ data, paging }` envelope); default 50, max 500; cursor = base64url(`date|id`); ordering: `date DESC, id DESC` (transactional) / `createdAt DESC, id DESC` (master-data); filters: search (name ILIKE), paymentType, category, supplierId, customerId, productId, reason; `lib/pagination.ts` shared library | Locked — implemented |
| D18 | Transaction void/correction (F-07 remaining): immutable originals, offsetting reversal rows, unique `(targetType, targetId)`, `SELECT ... FOR UPDATE` race closure, report exclusion, status exposure. D18.1–D18.11 | Locked — implemented |
| D19 | Security hardening: D19.1 process-local rate limiting (F-08 — auth per IP, API writes per user, 429, env-configurable), D19.2 security headers + strict CSP + no-CORS (F-11), D19.3 route id format validation (P3 — `assertUuid`/`assertUserId` → 400), D19.4 last-active-OWNER async mutex (P4). All document the single-process deployment model | Locked — implemented |
| D20 | Data export (M20): six read-only `/api/exports/*` endpoints that serialize the exact D7 report payload (no own computation, no DB writes). D20.1 CSV = comma + RFC-4180 quoting + CRLF + UTF-8 BOM, deterministic metadata + table sections, bare numeric cells (negative balances preserved), text-only formula-injection guard; JSON = UTF-8, no BOM. D20.2 full-range exports, never truncated at the 50-row pagination cap, streamed chunk-per-row/element. D20.3 authorization reuses D9.6 (CASHIER: sales + stock only; no separate export role matrix); exports are GET reads and are never rate-limited (F-08) | Locked — implemented |
| D21 | Responsive mobile-first frontend (M21): same-origin Next.js App Router app consuming only the existing `/api/*` endpoints (no new data plane, no CORS change, UI-page CSP). D21.2 mobile-first breakpoints + navigation (bottom tabs <768 / icon rail 768–1199 / sidebar ≥1200); D21.3 touch targets ≥44 px + double-submit prevention; D21.4 fast sales entry centerpiece; D21.5 tables→cards transform, never shrink; D21.6 simple stock/customer/payment workflows; D21.7 role-adaptive menu (D9.3); D21.8 explicit error/loading/empty states. M21 scope resolved by PM: wallet read-only, no customer-filter on sales, no low-stock alert, report presets Today/7d/30d/month/custom (shop-local), no day-close | Locked — in progress (Phase A 16 Aug 2026; Phase B.1 `/sales/new` POS shipped 16 Aug 2026; Phase B.2 sales list/detail/OWNER void shipped 17 Aug 2026) |
| D22 | M21 frontend architecture & stack: Next.js 16 App Router (RSC shell + minimal client islands) + Tailwind v4 + `better-auth/react`; new deps TanStack Query (server state), Zustand (cart only), React Hook Form + Zod, shadcn/ui (curated) + lucide-react + Sonner; NOT added Recharts (no charts, plan §2), `@tanstack/react-table` (semantic tables), Playwright (post-M21), Redux. State separation: TanStack / Zustand / useState / searchParams / RHF+Zod; backend authoritative for all business math. Mobile-first three-tier responsive; Vitest unit + jsdom component tests in the gate | Locked — implemented (Phase A 16 Aug 2026: deps + shadcn/ui + Zustand cart + RHF/Zod sign-in + `test:frontend` jsdom gate, 45 tests; Phase B.1 POS exercises TanStack Query + Zustand cart + Zod payload validation) |

## 5. Architecture Currently Implemented

```
API Routes  (app/api/...)
    ↓
Validation  (modules/*/*.validation.ts → ValidationError 400)
    ↓
Service     (modules/*/*.service.ts — business rules, one $transaction per op)
    ↓
Repository  (modules/*/*.repository.ts — persistence, Decimal → number)
    ↓
Prisma / PostgreSQL
```

Where things live:

- **Transactions:** services, one `$transaction` per multi-step operation
  (e.g. a CREDIT sale updates wallet?/balance + stock atomically).
- **Mapping:** `*.mapper.ts` files convert Prisma models ↔ domain types;
  Decimal → `number` at repository boundaries (`toNumber()` / `.toNumber()`).
- **Validation:** per-module validation functions; errors thrown as
  `ValidationError`.
- **Errors:** `lib/errors.ts` taxonomy → `lib/response.ts` `toHttpResponse()`
  (400 / 404 / 409 / 500).
- **Business rules:** services only; repositories never enforce business logic.

Modules currently present (verifiable under `modules/`):

```
modules/
├── products/
├── sales/
├── purchases/
├── suppliers/
├── supplier-payments/
├── customers/
├── customer-payments/
├── stock/
├── wallet/
├── reports/
├── voids/
├── exports/
└── users/
```

(Directory listing is authoritative — these ten exist in the repository.)

## 6. Current Business Flow Coverage

All flows below are implemented in code. Status reflects the actual repository.

**SALES**
- CASH — COMPLETE
- ECASH — COMPLETE
- CREDIT — COMPLETE
- Customer credit (signed balance / prepaid) — COMPLETE
- Customer payments — COMPLETE

**PURCHASING**
- CASH — COMPLETE
- CREDIT — COMPLETE
- Supplier balance — COMPLETE
- Supplier payments — COMPLETE

**STOCK**
- Purchase (+qty) — COMPLETE
- Sale (−qty) — COMPLETE
- DAMAGE (−qty) — COMPLETE
- CORRECTION (±qty to target) — COMPLETE

**WALLET**
- Sale deposits — COMPLETE
- Customer credit-payment deposits — COMPLETE
- Supplier-payment withdrawals — COMPLETE

**REPORTING**
- Sales, Purchases, Stock, Customers, Suppliers, Wallet — COMPLETE

## 7. Verification Evidence

Summarized from live runs on the local PostgreSQL (`erp_retail`) via
`npx next dev -p 3001` and `curl`/Postman; every value cross-checked with raw
SQL.

- **TypeScript:** `npx tsc --noEmit` PASS (latest run green).
- **ESLint:** `npm run lint` PASS.
- **API verification:** create/list/get for products, suppliers, customers,
  sales, purchases; POST failures return correct 400/404/409.
- **Raw SQL reconciliation:** all six report figures matched SQL re-derivation
  exactly (e.g. sales total 680, purchases 5020, wallet balance −4235).
- **Stock reconciliation:** per product `stockQty == Σ movements` — Rice 13/13,
  Oil 10/10, Biscuits 30/30 (ALL OK).
- **Wallet reconciliation:** `balance == ΣDEPOSIT − ΣWITHDRAWAL` (−4235 =
  785 − 5020) holds.
- **Customer balance reconciliation:** Ramesh −5, Sita −100 (prepaid);
  outstanding credit 0, prepaid credit 105 — matches payments history.
- **Supplier balance reconciliation:** Kathmandu Wholesale balance 0 (paid off);
  payment history 1520·2 matches SQL.
- **Read-only reporting verification:** all 11 table counts byte-identical
  before vs after report queries (including date-filtered variants).
- **Atomicity verification:** failed stock adjustments / invalid payments left
  all table counts unchanged.
- **DB hardening (F-05, Milestone 13):** all 17 CHECK constraints present in
  `pg_constraint` and all 9 report indexes in `pg_indexes` on both
  `erp_retail` and `erp_retail_test`; `tests/integration/db-hardening.test.ts`
  24/24 — raw-SQL invalid rows rejected at the DB layer while signed customer
  (D4) / supplier (D3) balances, CORRECTION `qty_change 0`, and valid
  PURCHASE/SALE signs keep working; D3/D4/D6 + wallet reconciliation holds.
- **Money + timezone (F-06/F-09, Milestone 15):** `tests/unit/money.test.ts`
  12/12 (rupeesToPaisa / paisaToRupees / round-half-up / paisaFromDecimal /
  MAX_AMOUNT_PAISA round-trips) and `tests/unit/timezone.test.ts` (naive
  shop-local parsing, explicit-zone passthrough, impossible-date rejection);
  full gate re-run green with paisa domain values (150 unit + 73 integration
  + 5 concurrency + 12 error + 11 bounds + 15 smoke + 17 auth = 283).
- **Postman collection status:** `postman/Retail-ERP.postman_collection.json`
  — 58 requests, 9 folders, valid JSON.

## 8. Current State

**WHAT IS COMPLETE NOW**
- Products & tier pricing, Sales, Purchasing, Suppliers, Supplier Payments,
  Customers, Customer Credit, Stock Adjustments, Wallet ledger, Reporting.
- Business decision records D1–D7; milestone implementation log.
- Postman API verification suite; README; repository committed on GitHub
  (`shishirg46/retail-erp`, `main`), working tree clean, `main` in sync with
  `origin/main`.

**WHAT IS CURRENTLY BEING WORKED ON**
- **F-02 stock concurrency hardening is COMPLETE (Milestone 7)** — closed in
  GitHub issue ERP-001.
- **F-01 product validation is COMPLETE (Milestone 8)** — see
  [`docs/architecture-audit.md`](architecture-audit.md) (F-01 → FIXED) and
  [`docs/implementation-log.md`](implementation-log.md) (Milestone 8). Closed in
  ERP-002.
- **F-03 error privacy is COMPLETE (Milestone 9)** — generic sanitized 500s with
  server-side logging; unit (`test:error` 11/11) + HTTP (`test:http` 12/12,
  unreachable-DB leak-canary proof) suites added. Tracking:
  [GitHub issue ERP-003](https://github.com/shishirg46/retail-erp/issues/3).
  Closed.
- **F-04 input upper bounds is COMPLETE (Milestone 10)** — shared caps in
  `lib/bounds.ts` enforced in all six validators; over-limit → 400 before any
  allocation (the documented `quantity: 1e8` DoS payload returns 400 < 15 s);
  unit (`test:bounds` 28/28) + HTTP (`test:http:bounds` 11/11, incl. boundary
  MAX success + liveness) suites added. Tracking:
  [GitHub issue ERP-004](https://github.com/shishirg46/retail-erp/issues/4).
  Closed (PM-approved).
- **F-15 automated regression suite is COMPLETE (Milestone 11)** — the full
  D1–D7 gate (`npm run test:all`, 17 suites / 197 assertions, 0 failures) runs
  exclusively against `erp_retail_test` and covers: unit (pricing D1 +
  validators D1–D7), integration (sales, purchases, customer-payments,
  supplier-payments, stock, rollback, ledger, reports), HTTP smoke across the
  D1–D7 API surface, plus the existing concurrency/bounds/error suites. Dev
  database (`erp_retail`) proven byte-identical before/after. Tracking:
  [GitHub issue ERP-005](https://github.com/shishirg46/retail-erp/issues/5).
  Closed (PM-approved). Standardized on Vitest (Milestone 12).
- **F-05 DB hardening is COMPLETE (Milestone 13)** — migration
  `20260814034336_db_hardening_f05` adds 17 CHECK constraints (restating the
  service-enforced rules at the DB layer, signed semantics preserved — no
  constraint on customer/supplier balances or CORRECTION) and 9 report
  indexes. Pre-migration validator (`scripts/validate-f05-preconditions.mjs`)
  green on both DBs; `tests/integration/db-hardening.test.ts` 24/24 proves the
  constraints/indexes exist in the catalog, raw SQL cannot write invalid rows,
  and legitimate signed/special values still work. Full gate now 18 suites /
  221 tests, exit 0; dev DB byte-identical before/after. **CLOSED
  (PM-approved) — ERP-006.**
- **F-06/F-09 money & timezone is COMPLETE (Milestone 15)** — D11 integer-paisa
  domain money: `lib/money.ts` (`rupeesToPaisa`/`paisaToRupees`/`roundHalfUp`/
  `paisaFromDecimal`/`MAX_AMOUNT_PAISA`), validators convert rupees→paisa once,
  services/repositories/reports do whole-paisa math, repositories read/write
  rupees `DECIMAL` (no migration), routes return rupees via `to*Api` mappers —
  API/report JSON shape and values unchanged. D10 shop-local timezone:
  `lib/timezone.ts` (`ERP_TIMEZONE` default `Asia/Kathmandu`, runtime env),
  naive report params parsed as shop-local wall clock, explicit-zone ISO
  strings as-is, `range` echo as shop-local offset strings. Robustness
  ride-along: shared `lib/auth/session-cookie.ts` + `requireUser` cookie
  short-circuit. New unit suites `money` (12) + `timezone`; all suites
  converted to paisa domain expectations (HTTP/report rupee values unchanged);
  all four HTTP suites now warm their routes. Full gate now 23 test files / 283
  tests, exit 0; dev DB byte-identical before/after. Tracking:
  [GitHub issue ERP-008](https://github.com/shishirg46/retail-erp/issues/8).
  Evidence commented; left open for PM review.
- Next audit fix pending PM decision: F-10 (ERP-007), F-06/F-09 (ERP-008) and
  M18 voids (ERP-009) evidence reviewed by PM — **all CLOSED COMPLETE**; M19
  (F-08/F-11/P3/P4) shipped and committed; M20 (data export) shipped, PM-approved,
  committed at `11bd68e` and pushed.
- **M20 data export is COMPLETE and committed** — six read-only
  endpoints at `/api/exports/{sales,purchases,stock,customers,suppliers,wallet}`
  serialize the D7 reports as CSV (UTF-8 BOM, RFC-4180, formula-injection
  guard, metadata + table sections) or JSON (byte-identical to the report
  endpoint). Full-range and streamed (D20.2); no 50-row cap. Auth reuses D9.6
  (D20.3): CASHIER gets sales + stock, 403 on the rest; GET reads never
  rate-limited (F-08). `modules/exports/` + `app/api/exports/`. New tests:
  `tests/unit/exports.test.ts` (14) + `tests/http/exports-http.test.ts` (11).

**WHAT HAS NOT BEEN STARTED**
- Frontend UI; dashboards; advanced reporting; audit logs.
- Deployment, backups, observability, load testing.

**WHAT SHOULD NOT BE CHANGED WITHOUT A BUSINESS DECISION**
- The stock baseline invariant (D6) — products start at 0, opening stock only
  via CORRECTION.
- The wallet ledger invariant (D3) and signed customer balance semantics (D4).
- Anything around COGS / inventory valuation / profit — no costing method yet
  (D2 limitation, D7 rule).
- Reporting must stay read-only and derived (D7); never store report totals.

## 9. Immediate Next Steps

The **full ERP architecture audit is complete** — see
[`docs/architecture-audit.md`](architecture-audit.md) for the 16-section report,
finding table (F-01…F-16), recommended fix order (P0–P3), and proposed next
milestones. **F-02 (stock concurrency) is fixed (Milestone 7)**; remaining
items below are proposals to review with the project manager.

### Step 1 — Fix P0 Findings
P0 (per audit): **(1) F-02 atomic stock availability under concurrency — DONE**
(atomic conditional decrement for SALE + DAMAGE, `tests/concurrency/stock.ts`
proving stock never goes negative); **(2) products validation for
`POST /api/products` (F-01) — DONE** (`product.validation.ts` wired into the
route; invalid payloads → 400; `tests/unit/product.validation.ts` 30/30).

### Step 2 — Fix Remaining HIGH/Selected Findings
P1 (per audit): auth/roles decision (F-10) — DONE, automated test framework
(F-15) — DONE, DB CHECK + indexes (F-05) — DONE. Pagination/search/filtering
(F-07/D12) — DONE (Milestone 16). Transaction void/correction (F-07 remaining)
— DONE (Milestone 18). Rate limiting (F-08), security headers/CORS (F-11),
id validation (P3) and OWNER race (P4) — DONE (Milestone 19).

### Step 3 — Regression Testing
Run the complete existing feature suite after fixes (Postman folders + SQL
reconciliation invariants + `tsc`/`lint`). **DONE** — `npm run test:all` gate:
unit 203 (incl. exports 14) + integration 91 + concurrency 9 + HTTP 17 + HTTP
bounds 13 + HTTP smoke 15 + auth 17 + pagination 32 + voids 11 + exports HTTP
11 = **419 tests**, exit 0, against `erp_retail_test` only.

### Step 4 — Production Readiness
Only after the audit findings and regression testing. Remaining open items:
deployment, backups/observability, and load testing. ERP-007 / ERP-008 /
ERP-009 evidence was PM-reviewed and closed COMPLETE.

## 10. Future Roadmap

### Near Term
Required to make the backend robust, per
[`docs/architecture-audit.md`](architecture-audit.md) recommended fix order:
**atomic stock / concurrency hardening (F-02) — DONE**; **products validation
(F-01) — DONE**; **error privacy (F-03) — DONE**; **input upper bounds
(F-04) — DONE**; automated tests for the existing flows (F-15) — DONE;
DB CHECK + indexes (F-05) — DONE; **pagination / search / filtering on list
endpoints (F-07/D12) — DONE**; **transaction void/correction (F-07 remaining,
M18) — DONE**; **rate limiting (F-08), security headers/CORS (F-11), id
validation (P3), OWNER race (P4) — DONE (M19)**. `.env.example` — DONE.
Remaining: concurrency verification by load test, deployment.

### Medium Term
Features/modules that logically follow: a dashboard, advanced reporting,
audit logs, backups, observability, deployment. **Data export — DONE (M20)**
as a serialization of the D7 report layer (D20). **Responsive mobile-first
frontend — PLANNED (M21)** — kickoff package prepared: information
architecture, page-by-page wireframe spec (desktop/tablet/mobile), and D21
frontend decisions; the five M21 scope questions resolved by PM (15 Aug 2026)
and recorded in `docs/frontend-plan.md` §14; implementation pending PM
approval of the finalized plan.

### Backend backlog (recorded from the M21 scope resolutions — NOT M21)
- Manual wallet entries (`POST /api/wallet`, OWNER-only, sources
  `OWNER_WITHDRAWAL|EXPENSE|BANK_DEPOSIT|OTHER`, keeps the D6 balance
  invariant).
- Customer-specific sales history (`customerId` filter on `GET /api/sales` +
  tests; then extend customer detail UI with that customer's CREDIT sales).
- Per-product reorder point / low-stock threshold (product-specific, no global
  constant; surfaced on product create/update + as a real low-stock signal).
- Day close / daily reconciliation (`POST /api/day-close` + immutable snapshot
  keyed by shop-local date, payment-type totals, wallet balance, optional cash
  count, notes, already-closed guard).

### Long Term
Potential ERP features not yet implemented: barcode support, multi-shop
support, advanced inventory valuation / COGS / profit (requires a costing
method decision per D2), accounting integrations.

All items above are **FUTURE / NOT YET DECIDED** unless the repository or spec
commits to them. Nothing in this section is committed.

## 11. Technical Debt / Known Risks

Derived from actual repository inspection. Issues are honest and verifiable.

| Issue | Severity | Evidence | Recommended Next Action | Status |
| ----- | -------- | -------- | ----------------------- | ------ |
| No automated tests (unit/integration) | High | `tests/unit/` was empty; verification is manual/live + Postman | **RESOLVED (Milestone 11)** — full D1–D7 gate `npm run test:all` against `erp_retail_test` only; now 18 suites / 221 tests incl. F-05 db-hardening (Milestone 13) | VERIFIED |
| No `.env.example` | Medium | `README.md` instructs `cp .env.example .env` but the file does not exist | Create `.env.example` from `.env` shape | **RESOLVED (Milestone 19)** — `.env.example` committed with `DATABASE_URL`, `TEST_DATABASE_URL`, auth secret, and the rate-limit knobs |
| Raw error messages leaked on 500 | High | `lib/response.ts` returned `error.message` for non-`AppError` (F-03) | **RESOLVED (Milestone 9)** — generic 500 body; details logged server-side; `test:error` 11/11 + `test:http` 12/12 (incl. unreachable-DB leak-canary proof) | VERIFIED |
| Concurrency not formally verified | Medium | Concurrent stock/sales ops never load-tested; `stockQty` updates rely on `increment` within transactions | **RESOLVED (Milestone 7)** — SALE + DAMAGE use atomic conditional decrement (`reserveStock`); `tests/concurrency/stock.ts` proves no oversell and D6 holds | VERIFIED |
| CORRECTION with a negative target is a 400 (validation) rather than the 409 of D6 | Low | Validation rejects negative integers before the service's `InsufficientStockError`; 409 effectively reachable only via DAMAGE | Document or align semantics in the audit (behavior is safe) | KNOWN, DOCUMENTED |
| Per-product sales `amount` carries the D1 ≤ 3 paisa drift | Low | `productQuantities.amount = Σ qty × pricePerUnit` (e.g. 340.06 vs 340) | Keep informational; document in report docs | KNOWN, ACCEPTED (D1) |
| No pagination / search / filtering on list endpoints | Low | `GET /api/*` return full lists | **RESOLVED (Milestone 16 / D12)** — cursor-based pagination on all 8 list endpoints; backward-compatible; default 50, max 500; search + filters | RESOLVED |
| No auth / authorization anywhere | High (for production) | No auth middleware or user model in schema | Decide as part of production readiness | **RESOLVED (Milestone 14 / F-10)** — Better Auth, OWNER/CASHIER matrix, every route guarded (proxy gate + DB-backed check), same-origin enforcement, rate limiting (F-08, M19) |
| No rate limiting / security headers / CORS policy | Medium (for production) | No brute-force protection; no headers; no stated CORS policy | Ship F-08 + F-11 | **RESOLVED (Milestone 19)** — auth attempt + API write rate limits (429), baseline headers + strict CSP + CORP, no-CORS as policy |
| `tests/unit/` empty directory — untracked intent only | Low | Empty dir present on disk; `git ls-files tests/` shows nothing (git does not track empty directories) | Fill with tests or remove | OPEN |

## 12. Important Files

| File/Dir | Source of truth for |
| -------- | ------------------- |
| `README.md` | Project overview, architecture, module/route table, setup & verification workflow |
| `AGENTS.md` | Engineering conventions for agents (layering, money rule, invariants, log updates) |
| `docs/business-decisions.md` | WHAT was decided and WHY (D1–D21, change-management format) |
| `docs/frontend-plan.md` | M21 frontend kickoff package — information architecture + page-by-page wireframes (desktop/tablet/mobile), D21 decisions |
| `docs/implementation-log.md` | Detailed technical history — what shipped per milestone + verification evidence |
| `docs/project-progress.md` | WHERE WE ARE / WHERE WE GO NEXT (this file) |
| `docs/architecture-audit.md` | The full ERP architecture audit — findings F-01…F-16, fix order P0–P3, next milestones |
| `prisma/schema.prisma` | Canonical data model (source of truth for the database shape) |
| `prisma/migrations/` | Applied database migrations history |
| `postman/Retail-ERP.postman_collection.json` | Executable API verification suite |
| `modules/*/` | Per-domain business logic (services, repositories, mappers, validation) |
| `lib/errors.ts`, `lib/response.ts` | Error taxonomy and HTTP error mapping |

## 13. Git / Milestone History

From `git log --oneline` (hashes are actual):

| Commit | Feature | Status |
| ------ | ------- | ------ |
| `9065199` | Initial scaffold (create-next-app) | Baseline |
| `fefe506` | Product pricing + sales core | Merged into history |
| `db767f8` | Purchasing, suppliers, supplier payments | Merged into history |
| `d1db6bf` | Customers + customer credit (D4, D5) | Merged into history |
| `306b4d2` | Stock adjustments (D6) | Merged into history |
| `7e26188` | Read-only reporting (D7) | Merged into history |
| `c901cbf` | Business decisions D1–D7 + implementation log | Merged into history |
| `1fe00b2` | Project README + agent conventions | Merged into history |
| `510ca48` | Postman collection (58 requests / 9 folders) | Merged into history |
| `c2d6073` | Wallet transaction ledger | Merged into history |
| `8a28c10` | Project progress tracker (this file) | Merged into history |
| docs reconciliation | Documentation reconciliation + sync with `origin/main` | Merged into history |
| audit | Full ERP architecture audit (this commit — `docs/architecture-audit.md`) | Merged into history |
| `ab9f07a` | Cursor-based pagination/search/filtering (D12 / F-07, Milestone 16) | Merged into history |
| `049fee2` | Documentation reconciliation after D12 | Merged into history |
| `c314953` | Transaction void/correction (M18 / ERP-009) | Merged into history |
| `4fc1913` | Security hardening (M19 / F-08/F-11/P3/P4) + doc reconciliation | Merged into history |
| `11bd68e` | Data export (M20 / D20.1–D20.3) + docs + gate wiring | HEAD — pushed |

Branch `main`, tracked at `origin/main` (`github.com/shishirg46/retail-erp`).
`8a28c10` was 1 commit ahead of `origin/main` until the documentation
reconciliation commit that follows it was pushed.

## 14. How To Update This File

- Update this file after every major milestone.
- Never mark work complete without verification.
- Never remove historical completed milestones.
- Keep implementation details in `docs/implementation-log.md`.
- Keep business decisions in `docs/business-decisions.md`.
- Keep this file focused on project progress, status, roadmap, and risks.
- Update the "Current State", "Immediate Next Steps", and "Technical Debt"
  sections whenever the project state changes.
- When a milestone is completed, record what changed and what verification
  passed.
- If a decision changes, update `business-decisions.md` first, then reflect the
  impact here.

## 15. Final Status Snapshot

```
PROJECT STATUS:   BACKEND COMPLETE; AUDIT COMPLETE; ALL P0/P1/P2/P3 AUDIT
                  FINDINGS F-01…F-15 IMPLEMENTED (M7–M19); EXPORT ADDED (M20)
CORE BACKEND:     COMPLETE — products, sales, purchases, suppliers, customers,
                  customer credit, stock adjustments, wallet ledger
FINANCIAL FLOWS:  COMPLETE — wallet balance, supplier balance, signed customer
                  credit (D3/D4), no COGS/profit (D2/D7)
INVENTORY:        COMPLETE — auditable StockMovement ledger; invariant holds per
                  product (D6); SALE + DAMAGE concurrency-safe (F-02 fixed);
                  CORRECTION target stays last-writer-wins (documented)
MASTER DATA:      COMPLETE — products validated before persist (F-01 fixed):
                  price polarity, tier shape, string caps, 400 on invalid
ERROR HANDLING:   COMPLETE — sanitized 500s (F-03 fixed): unexpected errors return
                  exactly {message:"Internal Server Error"}, no message/path/DB/
                  host leak; details logged server-side; 400/404/409 unchanged
REPORTING:        COMPLETE — 6 read-only reports, SQL-verified, no stored totals
                  (D7); voided records excluded (D18.8)
EXPORTS (M20):    COMPLETE — /api/exports/* (sales, purchases, stock, customers,
                  suppliers, wallet) serialize the D7 reports as CSV (UTF-8 BOM,
                  RFC-4180, injection-guarded) or JSON; streamed, full-range,
                  never capped at 50 (D20.2); D9.6 roles reused (D20.3);
                  D20.1–D20.3 recorded
DOCUMENTATION:    COMPLETE — README, AGENTS.md, business-decisions (D1–D20),
                  implementation-log, project-progress, architecture-audit,
                  postman suite
TESTING:          COMPLETE — full D1–D20 + F-01…F-15 gate (`npm run test:all`,
                  36 test files, 419 tests, 0 failures, Vitest) against
                  erp_retail_test only: unit 203/203 (incl. exports 14),
                  integration 91/91, concurrency 9/9 (stock, void+payment,
                  last-OWNER), HTTP 17/17 (error-handling + rate-limit +
                  security-headers), HTTP bounds 13/13, HTTP smoke 15/15,
                  auth 17/17, pagination 32/32, voids 11/11,
                  exports HTTP 11/11
DB HARDENING:     COMPLETE — 17 CHECK constraints + 9 report indexes (F-05,
                  M13): constraints/indexes proven in pg_catalog, raw SQL
                  cannot write invalid rows (signed semantics preserved: no
                  constraint on customer/supplier balances or CORRECTION)
INPUT SAFETY:     COMPLETE — quantity/amount/items upper bounds (F-04 fixed):
                  MAX_ITEM_QUANTITY 1000.00 human quantity units (up to 2 dp),
                  internal scaled representation = 100000 hundredths; MAX_ITEMS_PER_DOCUMENT 100,
                  MAX_AMOUNT 10000000 enforced in all six validators; over-limit
                  → 400 before any allocation; route id format validation (P3)
AUTH (F-10, M14): COMPLETE — Better Auth (local username+password, sign-up
                  disabled), OWNER/CASHIER roles, all routes guarded (coarse
                  proxy gate + authoritative DB-backed check), OWNER user
                  management (create/list/get/role/ban/unban/reset-password/
                  delete, last-OWNER invariant closed with a mutex in M19/P4),
                  D9.10 derived email never exposed, /api/auth/admin/* blocked,
                  same-origin enforcement, reset revokes sessions. D9 recorded.
                  ERP-007 closed COMPLETE
MONEY (F-06, M15): COMPLETE — integer-paisa domain money (D11): whole-paisa
                  math from validation to report sums; rupees in/out at the
                  API and DECIMAL rupees in Postgres unchanged (no migration);
                  round-half-up exactly once at the input boundary;
                  MAX_AMOUNT_PAISA guard; D1 pricePerUnit drift ≤ 1 paisa/sale
TIMEZONE (F-09, M15): COMPLETE — shop-local timezone (D10): ERP_TIMEZONE env
                  (default Asia/Kathmandu), naive report params parsed as
                  shop-local wall clock (Intl-offset), explicit-zone ISO as-is,
                  range echo as shop-local offset strings, no schema change
VOIDS (F-07 rem., M18): COMPLETE — 5 OWNER-only void endpoints (sales,
                  purchases, credit payments, supplier payments, CORRECTION
                  stock movements); immutable originals + offsetting reversal
                  rows; unique (targetType,targetId) + SELECT ... FOR UPDATE
                  race closure (D18.11); reports exclude voided records
                  (D18.8); status ACTIVE/VOIDED exposed (D18.9); D18.1–D18.11
                  recorded. ERP-009 closed COMPLETE
SECURITY (M19):   COMPLETE — F-08 rate limiting (auth attempts per IP, 20/15min;
                  state-changing API requests per user, 300/60s; GET never
                  limited; 429; env-configurable; process-local, single-process
                  documented); F-11 headers (nosniff, referrer-policy,
                  x-frame-options, permissions-policy) + strict CSP +
                  CORP same-origin on /api, no-CORS as policy; P3 route id
                  validation (assertUuid/assertUserId → 400); P4 last-OWNER
                  async mutex. D19.1–D19.4 recorded
CURRENT TASK:     M20 data export complete, PM-approved, committed (`11bd68e`)
                  and pushed; M21 Phase A foundation committed; B.1 POS
                  `/sales/new` shipped; B.2 sales list/detail/OWNER void
                  shipped (`a147d9a`); C.1 products & stock frontend shipped
                  (`8a4cc99`); gate 419/419 green. Documentation
                  reconciliation pending for C.1 milestone.
NEXT TASK:        PM review of C.1 documentation changes; then Phase C.2
                  (customers & payments) per docs/frontend-plan.md §13
PRODUCTION READY: NO — deployment, backups/observability, and load testing
                  remain; all audit findings (F-01…F-15) are implemented
```
