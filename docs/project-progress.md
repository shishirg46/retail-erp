# Retail ERP — Project Progress

SINGLE HIGH-LEVEL PROGRESS/MILESTONE TRACKER for the Retail ERP project.
Companion files:

- [`business-decisions.md`](business-decisions.md) — WHY / business rules (D1–D7)
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
  only). No UI beyond the API surface.

## 2. Current Overall Status

| Area | Status |
| ---- | ------ |
| Core transactional backend | COMPLETE |
| Financial architecture (wallet, balances) | COMPLETE |
| Inventory architecture (stock ledger) | COMPLETE |
| Reporting | COMPLETE |
| Architecture audit | NEXT |
| Production readiness | NOT YET COMPLETE |

Evidence:

- **Branch:** `main`
- **Latest commit:** `c2d6073 feat: wallet transaction ledger`
- **Milestone/feature commits:** 9 feature/milestone commits after the initial
  scaffold (10 commits total on `main`) — verifiable via
  `git rev-list --count 9065199..HEAD`.
- **Working tree:** clean (`git status -s` empty).
- **Typecheck / lint:** currently pass — `npx tsc --noEmit` OK, `npm run lint`
  OK.

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
└── reports/
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
- **Postman collection status:** `postman/Retail-ERP.postman_collection.json`
  — 58 requests, 9 folders, valid JSON.

## 8. Current State

**WHAT IS COMPLETE NOW**
- Products & tier pricing, Sales, Purchasing, Suppliers, Supplier Payments,
  Customers, Customer Credit, Stock Adjustments, Wallet ledger, Reporting.
- Business decision records D1–D7; milestone implementation log.
- Postman API verification suite; README; repository committed and pushed to
  GitHub (`shishirg46/retail-erp`, `main`), working tree clean.

**WHAT IS CURRENTLY BEING WORKED ON**
- Nothing new — the roadmap places the **FULL ERP ARCHITECTURE / IMPLEMENTATION
  AUDIT** next (per `docs/implementation-log.md` "Current state / Next" and the
  project plan).

**WHAT HAS NOT BEEN STARTED**
- Architecture audit (next, not yet done).
- Automated unit/integration tests (`tests/unit/` is empty).
- Authentication / authorization / roles.
- Frontend UI; dashboards; advanced reporting; exports; pagination/search.
- Deployment, backups, observability.

**WHAT SHOULD NOT BE CHANGED WITHOUT A BUSINESS DECISION**
- The stock baseline invariant (D6) — products start at 0, opening stock only
  via CORRECTION.
- The wallet ledger invariant (D3) and signed customer balance semantics (D4).
- Anything around COGS / inventory valuation / profit — no costing method yet
  (D2 limitation, D7 rule).
- Reporting must stay read-only and derived (D7); never store report totals.

## 9. Immediate Next Steps

Expected next major task (verify before starting): full ERP audit.

### Step 1 — Full Architecture Audit
Audit: architecture, database/schema, modules, transactions, concurrency,
validation, error handling, repository/service boundaries, Decimal → number
mapping, unsafe casts / `any`, database constraints, API consistency, security,
reporting, test coverage, documentation, Postman. Do NOT claim the audit is
complete unless it actually is.

### Step 2 — Fix Audit Findings
Only after the audit is documented. Classify findings: Critical / High /
Medium / Low / Nice-to-have.

### Step 3 — Regression Testing
Run the complete existing feature suite after fixes (Postman folders + SQL
reconciliation invariants + `tsc`/`lint`).

### Step 4 — Production Readiness
Only after the audit and regression testing.

## 10. Future Roadmap

### Near Term
Things required to make the current backend robust: automated tests for the
existing flows, `.env.example` (referenced by README but absent), pagination /
search / filtering on list endpoints, concurrency verification.

### Medium Term
Features/modules that logically follow: authentication/authorization and
roles/permissions, a dashboard, advanced reporting, export, audit logs,
backups, deployment, observability.

### Long Term
Potential ERP features not yet implemented: frontend/UI, barcode support,
multi-shop support, advanced inventory valuation / COGS / profit (requires a
costing method decision per D2), accounting integrations.

All items above are **FUTURE / NOT YET DECIDED** unless the repository or spec
commits to them. Nothing in this section is committed.

## 11. Technical Debt / Known Risks

Derived from actual repository inspection. Issues are honest and verifiable.

| Issue | Severity | Evidence | Recommended Next Action | Status |
| ----- | -------- | -------- | ----------------------- | ------ |
| No automated tests (unit/integration) | High | `tests/unit/` is empty; verification is manual/live + Postman | Add tests for the transactional flows after the audit | OPEN |
| No `.env.example` | Medium | `README.md` instructs `cp .env.example .env` but the file does not exist | Create `.env.example` from `.env` shape | OPEN |
| Concurrency not formally verified | Medium | Concurrent stock/sales ops never load-tested; `stockQty` updates rely on `increment` within transactions | Load-test concurrent sales/stock adjustments in the audit | NOT VERIFIED |
| CORRECTION with a negative target is a 400 (validation) rather than the 409 of D6 | Low | Validation rejects negative integers before the service's `InsufficientStockError`; 409 effectively reachable only via DAMAGE | Document or align semantics in the audit (behavior is safe) | KNOWN, DOCUMENTED |
| Per-product sales `amount` carries the D1 ≤ 3 paisa drift | Low | `productQuantities.amount = Σ qty × pricePerUnit` (e.g. 340.06 vs 340) | Keep informational; document in report docs | KNOWN, ACCEPTED (D1) |
| No pagination / search / filtering on list endpoints | Low | `GET /api/*` return full lists | Add after near-term hardening | OPEN |
| No auth / authorization anywhere | High (for production) | No auth middleware or user model in schema | Decide as part of production readiness | FUTURE |
| `tests/unit/` empty directory committed intent only | Low | Empty dir in tree | Fill with tests or remove | OPEN |

## 12. Important Files

| File/Dir | Source of truth for |
| -------- | ------------------- |
| `README.md` | Project overview, architecture, module/route table, setup & verification workflow |
| `AGENTS.md` | Engineering conventions for agents (layering, money rule, invariants, log updates) |
| `docs/business-decisions.md` | WHAT was decided and WHY (D1–D7, change-management format) |
| `docs/implementation-log.md` | Detailed technical history — what shipped per milestone + verification evidence |
| `docs/project-progress.md` | WHERE WE ARE / WHERE WE GO NEXT (this file) |
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
| `c2d6073` | Wallet transaction ledger | HEAD / latest |

Branch `main`, tracked at `origin/main` (`github.com/shishirg46/retail-erp`).

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
PROJECT STATUS:   IMPLEMENTATION COMPLETE (backend + reporting); AUDIT NEXT
CORE BACKEND:     COMPLETE — products, sales, purchases, suppliers, customers,
                  customer credit, stock adjustments, wallet ledger
FINANCIAL FLOWS:  COMPLETE — wallet balance, supplier balance, signed customer
                  credit (D3/D4), no COGS/profit (D2/D7)
INVENTORY:        COMPLETE — auditable StockMovement ledger; invariant holds per
                  product (D6)
REPORTING:        COMPLETE — 6 read-only reports, SQL-verified, no stored totals
                  (D7)
DOCUMENTATION:    COMPLETE — README, AGENTS.md, business-decisions (D1–D7),
                  implementation-log, project-progress, postman suite
TESTING:          PARTIAL — Postman + live/SQL verification pass; no automated
                  tests; concurrency unverified
CURRENT TASK:     Recording project state (this file); no code work pending
NEXT TASK:        FULL ERP ARCHITECTURE / IMPLEMENTATION AUDIT (part 0 of 0)
PRODUCTION READY: NO — audit, fixes, regression testing, and auth/deployment
                  decisions remain
```