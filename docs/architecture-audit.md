# Retail ERP Architecture Audit

**Date:** 13 Aug 2026
**Audited commit:** `cd3458e` (`docs: reconcile README and project-progress with repository state`)
**Scope:** `main` branch, full transactional backend (products, sales, purchasing, suppliers,
customer credit, stock, wallet, reporting), Prisma schema + migrations, all API routes, lib/,
error taxonomy, git state.
**Method:** static source inspection; `npx tsc --noEmit --incremental false`; `npm run lint`;
`prisma validate`; raw SQL-read reconciliation claims cross-checked against code. No load
test was run; concurrency is analyzed from code + database semantics (see §4).

---

## Executive Summary

The backend is **architecturally sound and internally consistent** for a single-writer,
single-shop workload. The strict **Route → Service → Repository → Prisma** layering holds for
every transactional flow (Sales, Purchasing, Supplier Payments, Customer Payments, Stock
Adjustments) — each runs inside exactly one `$transaction`, all of its queries use the
transaction client, and Decimal → `number` conversion happens at the repository boundary. The
four money-ledger invariants hold **by construction** (increment-based balances; append-only
wallet), and the reporting layer is genuinely read-only.

The audit found **no critical data-corruption defects** and **no contradictions between
documentation and repository** (the prior reconciliation session is now consistent).

The gaps that matter, in order of importance:

1. **A real concurrency race in stock** (HIGH). Sales and stock adjustments use a
   *read → check → increment* pattern with no row lock, no conditional update, and no
   serializable isolation. Two concurrent requests can both pass the stock check and
   oversell → negative `stockQty`, violating D6. Customer/supplier balances are safe because
   they update via atomic `increment`; the wallet is append-only — so the financial ledgers
   are concurrency-safe; **stock is the one exposed surface**.
2. **Products endpoint is layered differently and unvalidated** (HIGH). `POST /api/products`
   has no `*.validation.ts`, casts the body with `as CreateProductInput`, and calls the
   repository directly (no service). Unlike the other seven POST endpoints, it can persist
   malformed master data (negative prices, bad tier shapes) and converts those errors into
   raw 500 responses.
3. **500 responses leak raw error messages** (HIGH). `toHttpResponse` returns
   `error.message` for any unknown error — contradicting its own comment that DB errors are
   "never leaked".
4. **No authentication/authorization anywhere** (HIGH, known & planned). Every endpoint is
   open; production-readiness is not yet possible.
5. Medium: unbounded quantities → memory-exhaustion DoS in pricing; no DB CHECK constraints/
   secondary indexes; float money arithmetic beyond the documented D1 drift; no pagination.

Recommendation: proceed with the **P0 concurrency + products-layering fixes** before the next
feature, per the fix order in §“Recommended Fix Order”.

## Overall Assessment

| Area | Assessment |
| ---- | ---------- |
| Architecture layering | Good — uniform for transactional modules; Products deviates (documented now) |
| Transactions | Correct — single `$transaction` per op; no partial-state risk |
| Concurrency | Financial safe; **stock oversell race** (HIGH, unverified by load test) |
| Database / Prisma | Schema consistent with migrations; **no CHECK constraints / missing indexes** |
| Validation | Solid except **Products (none)**; no upper bounds on quantities/amounts |
| Error handling | Taxonomy clean; **500s return raw `error.message`** |
| Type safety | `tsc --noEmit` green; no `any`; mild enum/Db casts (acceptable) |
| API design | Consistent shapes/status codes; **no pagination/search/update endpoints** |
| Security | No auth (planned); no CORS/rate limits; `.env` untracked; Prisma parameterized (no SQLi) |
| Financial consistency | Invariants hold by construction — verified in code |
| Inventory consistency | Identity `stockQty == Σ qtyChange` holds; negative stock possible only via the race |
| Business rules D1–D7 | All implemented correctly; D6 has one documented validation nuance (400 vs 409) |
| Reporting | Genuinely read-only; aggregates match SQL re-derivation; D1 drift documented |
| Testing | None automated (manual Postman + SQL) — highest operational risk |
| Documentation | Accurate and current after reconciliation |
| Git hygiene | Clean tree; `main == origin/main`; secrets untracked; generated client ignored |

---

## 1. Architecture

**Model:** `API Route → validation → Service → Repository → Prisma → PostgreSQL`, with
`AppError` taxonomy mapped in `lib/response.ts`.

| Module | Types | Validation | Mapper | Repository | Service | Txn | Route(s) |
| ------ | :---: | :--------: | :----: | :--------: | :-----: | :-: | -------- |
| products | ✓ | **✗** | — (inline) | ✓ | `calculatePrice` only | — | POST/GET `[id]`GET |
| sales | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | POST/GET `[id]`GET |
| purchases | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | POST/GET `[id]`GET |
| suppliers | ✓ | ✓ | — (inline) | ✓ | ✓ | — | POST/GET `[id]`GET |
| supplier-payments | ✓ | ✓ | — (inline) | ✓ | ✓ | ✓ | POST/GET |
| customers | ✓ | ✓ | ✓ | ✓ | ✓ | — | POST/GET `[id]`GET |
| customer-payments | ✓ | ✓ | — (inline) | ✓ | ✓ | ✓ | POST/GET |
| stock | ✓ | ✓ | — (inline) | ✓ | ✓ | ✓ (adjust) | POST/GET |
| wallet | ✓ | — | — (inline) | ✓ | — | — | — |
| reports | ✓ | ✓ | ✓ | ✓ | ✓ | — | 6 GETs |

Initial comments are positive:

- **Routes are thin.** Every route (except products) parses JSON, calls a validator, delegates
  to a service, and maps errors via `toHttpResponse`. No business logic in routes.
- **Repositories are persistence-only.** They accept a transaction client; Decimal → `number`
  occurs in mappers or inline `toNumber` at the boundary. No business rules in repositories.
- **Cross-module dependencies are healthy.** Services consume repositories (`PrismaXRepository`)
  and compose them inside a single transaction; globals (`lib/prisma`) are only used for
  read-only listing/get paths — never inside a write transaction callback.
- **Duplicated logic is minor.** The `parse-JSON-or-400` preamble and the `try/catch →
  toHttpResponse` shell are repeated across routes (acceptable at 19 files; a shared helper
  would be a P3 nicety). No duplicated business logic beyond the expected shared enums/types.

### The Products gap — is it a defect?

**Resolved (F-01, Milestone 8).** `POST /api/products` (`app/api/products/route.ts`) previously
did three things differently from every other endpoint:

1. **No validation module** — the route cast the body with `body as CreateProductInput` and
   passed it straight to the repository.
2. **Bypassed the service layer** (`PrismaProductRepository.create` directly).
3. **No mapper file** — Decimal → number conversion is inline in the repository.

Why this mattered:

- A product row is **master data other modules price off**. An invalid `currentPrice`
  (negative, `NaN`) or a malformed `priceTiers` array corrupts downstream sales/purchasing
  math. Prisma accepts arbitrary `Decimal` values, so nothing rejected a negative price.
- A body shape that Prisma rejects (e.g. `priceTiers: "hello"`) threw inside the route and
  surfaced as a **raw 500 with the driver's message**, not a 400.
- It was the only write endpoint whose request envelope was not narrowed by validation.

**Fix applied:** added `modules/products/product.validation.ts` mirroring `purchase.validation.ts`
(`costPrice ≥ 0`, `currentPrice > 0`, integer `minQty ≥ 1`, positive tier `price`, bounded
string lengths, duplicate-`minQty` rejection, unknown fields ignored) and wired the route to
validate then persist. A thin `ProductService` was deliberately **not** introduced (decision:
route → validation → repository). Invalid payloads now return 400; valid behavior unchanged.
**(F-01 — FIXED.)**

---

## 2. Database / Prisma

Schema `prisma/schema.prisma` and migrations are consistent (`prisma validate` passes;
`20260725045447_init` is the full baseline; `20260813050516_purchases_payment_type` adds the
`PurchasePaymentType` enum and the `SUPPLIER_PAYMENT` wallet source).

| Concern | Status |
| ------- | ------ |
| Enum usage | Enums for `PaymentType`, `PurchasePaymentType`, `WalletTxnType`, `WalletTxnSource`, `StockReason`. Match domain types in code. ✓ |
| Decimal money | `DECIMAL(65,30)` on all money columns; converted to `number` via `.toNumber()` at repository/report boundaries. ✓ |
| FKs / cascades | `sale_items`, `purchase_items`, `price_tiers` cascade with parent; `stock_movements`+`sale/credit FKs` RESTRICT/SET NULL — sensible. ✓ |
| Unique constraints | `@@unique([productId, minQty])` on `price_tiers` — good. |
| Nullability | `sale.customer_id` nullable (anonymous cash), `sale_id` on payments optional (D5), wallet FKs nullable — all intentional. ✓ |
| **CHECK constraints** | **None.** `stock_qty` has no `CHECK (stock_qty >= 0)`; money columns have no positivity checks; balances are unconstrained. Enforcement lives only in application code. **(F-05)** |
| **Secondary indexes** | **Only PKs + the price-tier unique.** No index on `stock_movements(product_id, date)`, `sale_items(product_id)`, `wallet_transactions(date/source)`, `credit_payments(customer_id)`, `purchase_items(product_id)`. Fine at shop scale; report joins will scan as data grows. **(F-05)** |

**Can the database design allow inconsistent states?** Not through schema alone today — all the
important consistency is enforced transactionally in services. The absence of a
`stock_qty >= 0` CHECK is the notable gap: combined with F-02 it means negative stock is
physically representable.

---

## 3. Transaction Audit

| Operation | Transaction | All queries transactional | Partial-state risk | Status |
| --------- | :--------: | :-----------------------: | :----------------: | ------ |
| Sales (`sale.service.ts`) | `$transaction` | Yes — all repos constructed with `tx` | None | **OK** (see F-02 for stock check race) |
| Purchases (`purchase.service.ts`) | `$transaction` | Yes | None | **OK** |
| Supplier Payments (`supplier-payment.service.ts`) | `$transaction` | Yes | None | **OK** |
| Customer Payments (`customer-payment.service.ts`) | `$transaction` | Yes | None | **OK** |
| Stock Adjustments (`stock.service.ts`) | `$transaction` | Yes | None | **OK** (see F-02 for check race) |

Verification specifics:

- Every multi-step operation is wrapped in a single `prisma.$transaction(async (tx) => …)`.
  If any step throws, the whole callback rolls back — no partial state can commit.
- Inside each callback, all reads and writes go through repositories constructed with `tx`
  (`new PrismaProductRepository(tx)`, etc.). The pattern is uniform.
- **No accidental global-client queries inside transaction callbacks.** Grep confirms every
  repository inside a txn is `tx`-bound; the global `prisma` is used only in read-only
  `list`/`findById` service methods and report queries, which need no transaction.
- Repositories accept the transaction client via a `Db` structural type
  (`{ stockMovement: typeof prisma.stockMovement }` etc.) — consistent and working (tsc-pass).

**Remaining transaction gap:** the *check* of `stockQty` happens on a value read earlier in
the same (READ COMMITTED) transaction, not atomically with the decrement — see §4, F-02.

---

## 4. Concurrency / Race Conditions

No load test was run. Analysis is from code + PostgreSQL semantics (Prisma's default
isolation on Postgres is **READ COMMITTED**; no explicit `isolationLevel` and no
`SELECT … FOR UPDATE` anywhere in the codebase — grep confirmed).

### The pattern that matters: read → check → atomic-write

Both `SaleService.createSale` and `StockService.adjustStock` do:

```
read  product.stockQty                 (not locked)
check stockQty < quantity  → reject    (app-side)
write updateStock(… increment −qty)    (atomic, but too late)
```

Under READ COMMITTED, two transactions can both read `stockQty = 1`, both pass the check, and
both apply `−1` → final stock `-1`, stock movement ledger records two `-1` rows
(reconciliation identity still numerically holds, but D6's “never negative” business rule is
violated and **customers are oversold stock that does not exist**).

| Race scenario | Safe? | Why |
| ------------- | :---: | --- |
| two concurrent sales, same product | **No** | read→check→increment not atomic → oversell, negative stock **(F-02, HIGH)** |
| sale + purchase, same product | Mostly | increments are atomic; no double-decrement of stock, but the sale’s availability check is still from a stale read |
| sale + stock adjustment | **No** | same read→check→write pattern as sales |
| two stock adjustments (DAMAGE/CORRECTION) | **No** | same pattern; both can pass the `qtyChange < 0` guard against a stale read |
| two CREDIT sales, same customer | **Yes** | `updateBalance` = atomic `increment` on `balance_owed`; no read-modify-write |
| two customer payments, same customer | **Yes** | atomic `increment` |
| sale (CREDIT) + customer payment | **Yes** | both are increments on the same signed balance; order-independent, net correct, D4 prepaid intact |
| simultaneous purchases, same supplier | **Yes** | `increment` on supplier balance + append-only wallet rows |
| simultaneous supplier payments | **Yes** | atomic increments; wallet withdrawals are inserts |
| purchase + supplier payment | **Yes** | increments commute; final balance correct |
| wallet deposits vs withdrawals | **Yes** | `wallet_transactions` is append-only; balance is `Σ`, never stored |

**Classification:** the **financial ledgers (customer balance, supplier balance, wallet) are
concurrency-safe by construction** (atomic increments + append-only ledger). The **stock
available-quantity check is the only genuinely racy, lossy operation** → **HIGH** (F-02).

**Fix direction (not applied):** make availability atomic — e.g. conditional decrement
(`updateMany({ where: { id, stockQty: { gte: quantity } }, data: { stockQty: { decrement } } })`
and check `count === 1`), or `SELECT … FOR UPDATE` via `$queryRaw`, or
`isolationLevel: Prisma.TransactionIsolationLevel.Serializable` with retry. All three fit the
existing layering. Verified-by-load-test is expected in the follow-up milestone.

---

## 5. Validation

| Endpoint | Body validation | Notes |
| -------- | :-------------: | ----- |
| `POST /api/products` | **FIXED (F-01)** | `product.validation.ts` — name/unit/category length caps, `costPrice ≥ 0`, `currentPrice > 0`, tier `minQty ≥ 1` + price > 0, duplicate-`minQty` rejected, unknown fields ignored. Invalid payloads → 400. |
| `POST /api/sales` | ✓ | enum `paymentType`, items non-empty, integer qty ≥ 1; customerId optional-string rule. Business checks (stock, customer-exists, CREDIT-needs-customer) correctly live in the service. |
| `POST /api/purchases` | ✓ | enum, product exists in service, integer qty ≥ 1, costPerUnit finite ≥ 0. |
| `POST /api/suppliers` | ✓ | name non-empty trimmed, contact optional string. |
| `POST /api/supplier-payments` | ✓ | amount positive finite. |
| `POST /api/customers` | ✓ | name non-empty trimmed, contact optional. |
| `POST /api/customer-payments` | ✓ | amount positive finite, optional saleId string; D5 link rules in service (404/400/400). |
| `POST /api/stock/adjustments` | ✓ | DAMAGE qty ≥ 1 integer; CORRECTION qty ≥ 0 integer; reason enum; note optional. |
| Reports `from`/`to` | ✓ | ISO parse + local-midnight coercion + `from > to` → 400. |

Consistent strengths: structural validation is separated from business validation (services);
malformed JSON returns a clean 400 in every route; unknown body fields are silently ignored
(acceptable); unwanted fields never persist.

Weaknesses:
- **Products had no validation** — now FIXED via `product.validation.ts` (F-01).
- **No upper bounds** on quantities or amounts anywhere — `POST /api/sales` quantity feeds
  `calculatePrice`, which allocates `new Array(qty + 1)` server-side. An unauthenticated
  request with `quantity: 1e8` allocates a ~800 MB array → **memory-exhaustion DoS** (F-04).
  Purchases quantities and payment amounts are similarly unbounded (lower impact).
- No max length on `name`/`contact`/`note` strings (minor).
- No ID-format validation — harmless (a non-UUID id simply finds nothing → 404).

---

## 6. Error Handling

`lib/errors.ts` taxonomy is clean:

- `ValidationError` (400), `NotFoundError` (404), `InsufficientStockError` (409),
  `BusinessRuleError` (400), `ConflictError` (409) → all subclass `AppError` with `statusCode`.
- `lib/response.ts` `toHttpResponse` maps `AppError → { message, status }`.

| Check | Result |
| ----- | ------ |
| 400 for validation/business-input errors | ✓ |
| 404 for missing resources | ✓ (`[id]` routes and services both return consistent `{ message }` 404) |
| 409 for conflicts / insufficient stock | ✓ (`InsufficientStockError`), also stock adjustment guard |
| 500 for unexpected errors | ✓ **FIXED (F-03, Milestone 9)** — generic message exactly |
| Raw Prisma/driver errors can leak | **No.** `lib/response.ts` returns `{ message: "Internal Server Error" }` for any non-`AppError` (message, stack, Prisma meta, paths, DB/host/port never serialized); the original error is logged server-side via `console.error`. Proven over real HTTP with an unreachable DB (`tests/http/error-handling.ts`). |
| Stack traces can leak | No — stack is not serialized. |
| Inconsistent error formats | No — all errors are `{ message }`. |
| Errors swallowed | No — all async callbacks rethrow; failed txn rolls back and is mapped. |

**F-03 (HIGH) — FIXED (Milestone 9):** `lib/response.ts` previously returned the raw `Error.message` for any non-`AppError`. Now every unexpected failure maps to exactly `{ "message": "Internal Server Error" }` (500), with the original error logged server-side (`console.error("[unhandled-error]", error)`). Covered by `tests/unit/error-response.ts` (11/11) and `tests/http/error-handling.ts` (12/12), the latter proving over real HTTP — against an unreachable database — that no driver text, filesystem paths, DB names, hosts, ports, or Prisma invocation details reach the client.

---

## 7. Type Safety

- `npx tsc --noEmit` — **PASS** (strict mode).
- No `any` / `as any` usage anywhere in `app/`, `lib/`, `modules/` (grep). The only
  `as unknown as` is the standard global-prisma singleton in `lib/prisma.ts` (correct).
- Decimal → number is handled at boundaries (`.toNumber()`). Reports use a defensive
  `toNumber(value)` that treats `null`/`undefined` sums as `0` (correct for `_sum` on empty
  sets) — good.
- Milder assertions exist but are justified:
  - enum `as` casts (`raw.reason as StockReason`, `row.paymentType as PaymentType`) — the DB
    enums guarantee membership, so these cannot produce invalid values.
  - repository `amount: unknown` then `raw.amount as { toNumber: () => number }` — consistent
    with the Decimal-boundary convention and tsc-verified.
- **Products route cast `body as CreateProductInput`** is the one place where an unchecked
  input is *typed* as a domain type without narrowing → already captured in F-01.

**Assessment:** no type-safety defect beyond the products cast; the architecture keeps domain
types clean.

---

## 8. API Design

| Concern | Status |
| ------- | ------ |
| Naming / methods | Consistent (`/api/<resource>`, POST = create, GET = list, GET `/[id]` = fetch). |
| Status codes | 201 create, 200 fetch/list, 400/404/409/500 errors — consistent. |
| Response shapes | Success returns the domain object; errors return `{ message }` — uniform. |
| Route structure | Matches module layout; routes are thin. |
| **Pagination** | **None.** All `GET /api/*` return full tables (products, sales, purchases, suppliers, customers, supplier-payments, customer-payments, stock movements). **(F-07)** |
| **Search / filtering** | Only stock movements (`?productId=`) and reports (`from`/`to`). **(F-07)** |
| **Update / delete** | **No PATCH/PUT/DELETE anywhere** — no way to correct a data-entry mistake or void a sale/payment. Limitation for auditing/ops (recorded, not a bug). |
| Resource ownership / IDOR | N/A — no auth or tenant model exists (covered by F-10). |
| ID validation | Implicit (unparseable id → not found → 404); no explicit format check (low value). |
| Response sizes | Unbounded lists; compounding with no pagination. |

Documented limitations: pagination/search/update are future roadmap items (project-progress §10);
audit confirms they are genuinely absent.

---

## 9. Security

| Check | Status |
| ----- | ------ |
| Authentication | **None.** No middleware, no user model, no session. **(F-10, HIGH)** |
| Authorization / roles | **None.** Every endpoint open to any caller. **(F-10)** |
| IDOR / resource ownership | N/A until auth exists. |
| Unrestricted POST endpoints | All 8 POST endpoints unauthenticated. |
| Sensitive error leakage | **FIXED (F-03, Milestone 9)** — generic 500 body, details logged server-side. |
| Input validation | Products validated (F-01 fixed); quantity/amount upper bounds enforced (F-04 fixed). |
| SQL injection | **Safe** — all queries are parameterized Prisma; no raw SQL/string interpolation. |
| Secrets in Git | **None.** `.env` is gitignored and untracked (`git ls-files | grep .env` empty — verified). |
| Env handling | `lib/prisma.ts` + `prisma.config.ts` read `DATABASE_URL` via dotenv; no hardcoded secrets. |
| CORS / headers / rate limiting | **Not configured.** No CORS config, no security headers, no rate limits. **(F-11, LOW)** |

**Meaning for production readiness:** F-10 alone means the backend must not be exposed to the
internet as-is. Until authentication/authorization lands, this is a **local/single-trust
network tool**. This is a known, planned gap (project-progress §9/§10/§11) — the audit
re-confirms it as the primary blocker to production.

---

## 10. Financial Consistency

All four invariants hold **by construction** (each mutation runs inside one transaction; all
ledger writes go through the audited services; balances are atomic increments; wallet is
append-only):

```
customer.balanceOwed == Σ CREDIT sales.total − Σ credit_payments.amount   (signed; D4)
supplier.balanceOwed == Σ CREDIT purchases.total − Σ supplier_payments.amount
wallet.balance      == Σ DEPOSIT − Σ WITHDRAWAL
stockQty            == Σ stock_movements.qtyChange                        (D6)
```

| Operation | Wallet | Customer | Supplier | Stock |
| --------- | ------ | -------- | -------- | ----- |
| CASH/ECASH sale | +total (SALE) | — | — | −qty (SALE) |
| CREDIT sale | — | +total | — | −qty (SALE) |
| CASH purchase | −total (SUPPLIER_PAYMENT) | — | — | +qty (PURCHASE) |
| CREDIT purchase | — | — | +total | +qty (PURCHASE) |
| Supplier payment | −amount (SUPPLIER_PAYMENT) | — | −amount | — |
| Customer payment | +amount (CREDIT_PAYMENT) | −amount | — | — |
| DAMAGE / CORRECTION | — | — | — | ±qty |

- Every write path mutates exactly the correct ledgers and nothing else (verified line-by-line
  in the five services; reports never write).
- D3 routing (CASH→wallet, CREDIT→balance) is implemented exactly as specified.
- Concurrency: balances are `increment`-based → order-independent → invariant preserved even
  under racing requests; the wallet identity holds because balance is a Σ, never a stored
  field. The **only** invariant-breaking race is stock oversell (F-02) — and even then the
  numeric identity `stockQty == Σ qtyChange` is preserved; the *business rule* “stock ≥ 0” is
  what breaks.

**Assessment:** financial invariants are sound. No operation can violate them through the HTTP
surface (single- or multi-request) except the stock-availability race.

---

## 11. Inventory Consistency

- Every stock change (purchase, sale, DAMAGE, CORRECTION) updates `Product.stockQty` and
  appends a `StockMovement` **in the same transaction** with the identical signed `qtyChange`.
- Failures roll back both — no movement without a stock change and no stock change without a
  movement (atomically).
- Baseline: products default `stockQty = 0`; opening stock enters via CORRECTION
  (`qtyChange = target − current`) → `stockQty == Σ movements` holds from creation.
- D6 guards (never go negative) reject the write *before* it happens in the serial case.
- **Concurrency caveat:** the availability check is not atomic (F-02) — under racing requests
  the identity still holds arithmetically, but stock can be driven negative, which D6’s
  business rule disallows. This is the one gap in this area.

---

## 12. Business Rules D1–D7

| Decision | Implemented correctly | Evidence | Risk |
| -------- | :--------------------: | -------- | ---- |
| **D1** effective `pricePerUnit` informational; `Sale.total` authoritative | **Yes** | `effectiveUnitPrice = round(total/qty, 2)` frozen in `sale.mapper`; totals from `calculatePrice`; wallet/balance driven by `total` | Known ≤3-paisa drift on per-line amount, documented and informational only |
| **D2** `costPrice` = latest cost; `PurchaseItem.costPerUnit` immutable history | **Yes** | `updateCostPrice` after each purchase; item costs frozen at create | Not COGS/valuation — documented (no costing method yet) |
| **D3** CASH purchase debits wallet; CREDIT raises supplier balance only | **Yes** | purchase.service branches on `paymentType`; WITHDRAWAL `SUPPLIER_PAYMENT` in same txn | None |
| **D4** overpayment → prepaid credit (signed balance) | **Yes** | `updateBalance(±amount)` signed increments; CREDIT sale adds to existing (possibly negative) balance | None |
| **D5** optional `saleId` on payments: exists (404) / belongs (400) / CREDIT-only (400) | **Yes** | customer-payment.service enforces all three | None |
| **D6** stock adjustment semantics + baseline + no-negative | **Yes** | DAMAGE `−qty`, CORRECTION `target − current`, pre-write rejection | **Concurrency race** (F-02) can still go negative; CORRECTION negative target yields 400 (validation) not 409 — already documented in project-progress |
| **D7** reporting read-only, derived, no stored totals, no COGS/profit | **Yes** | reports module has zero create/update/delete; values re-derivable from transactional tables; date ranges inclusive & echoed | D1 drift surfaces in product-level `amount`; timezone is server-local (§13) |

No new business decisions are required by this audit. The D6 “400 vs 409” nuance and D1 drift
are already recorded decisions/deviation notes, not new findings.

---

## 13. Reporting

- **Read-only verified.** `modules/reports/` contains only `findMany` / `aggregate` / `groupBy`
  (grep). It introduces **no** stored totals and no new source of truth — every reported value
  is a live derivation from transactional tables (D7), satisfying the “derived, not stored”
  architecture rule.
- **Aggregation correctness:** sales/purchases totals come from `aggregate(_sum)`
  (authoritative `Sale.total` / `Purchase.total`); by-payment-type and by-supplier from
  `groupBy`; customer/supplier payment histories from `groupBy(_sum.amount)`; wallet from
  `groupBy(source, type)`. These match the raw-SQL re-derivations recorded in the
  implementation-log.
- **Empty results:** `_sum` is `null` on empty sets → report `toNumber` maps to `0`;
  `groupBy`/`findMany` return `[]`. No crashes, correct UX.
- **Date handling:** `from ≤ date ≤ to` inclusive; bare `yyyy-mm-dd` coerced to local midnight
  (`from` `00:00:00.000`, `to` `23:59:59.999`); full ISO timestamps pass through; inverted
  ranges → 400; invalid → 400.
- **Timezone (INFO/F-09):** Postgres stores naive `TIMESTAMP(3)` (no tz) and coercion is
  *server*-local. Report day-boundaries therefore depend on the server timezone, not
  necessarily the shop’s. Not a defect at single-machine/single-tz deployments, but a
  documented decision is advisable before multi-region or shared hosting.
- **D1 drift:** `productQuantities.amount = Σ (qty × pricePerUnit)` carries the documented
  ≤3-paisa drift (e.g. 340.06 vs 340). It is informational — report totals always derive from
  `sales.total`. Confirmed in `report.types.ts`/compare with SQL findings.
- **No COGS / valuation / profit introduced** — consistent with D2/D7.

---

## 14. Testing

Current state (honest): **no test framework, no automated suite, no `test` script in
`package.json`**. Verification is manual — Postman collection (58 requests) + live SQL
reconciliation against a local Postgres, per implementation-log.

| Consideration | Assessment |
| ------------- | ---------- |
| Critical flows without automated tests | Sales, purchasing, both payment paths, stock adjustments, wallet ledger, all report derivations, all D1–D7 invariants |
| Unit-test opportunities | `calculatePrice` (D1 min-cost bundles), `effectiveUnitPrice`, report `toNumber`, validation functions, `coerceRangeQuery` |
| Integration-test opportunities | Route → service → repository with a real Postgres (or driver-adapter in-memory) per flow, asserting wallet/customer/supplier/stock side effects atomically |
| Transaction tests | Assert rollback on mid-flow failure (e.g. second sale item out of stock ⇒ no sale, no movement, no wallet row) |
| Concurrency tests | **Highest value** — two simultaneous sales on the last unit, DAMAGE + sale, two payments. Provable assertion: stock never < 0 (currently fails ⇒ proves F-02) |
| Regression coverage | Postman covers happy+error paths; no automated regression gate |

This is the **largest operational risk** in the project: D1–D7 correctness currently rests on
one person’s manual Postman passes. Automated coverage is a strong **P1** recommendation
(framework note: project uses Prisma 7 + `@prisma/adapter-pg`; a JS test runner and a test
Postgres or `pg-mem`-style adapter would fit).

---

## 15. Documentation

Audit confirms the five files are **accurate and internally consistent** after the
reconciliation commit `cd3458e`:

- `README.md` — correct stack, layering (now honestly describing products’ deviation), route
  table, setup (no `.env.example` noted), invariants. ✓
- `AGENTS.md` — conventions match implementation. Read before writing code (Next 16 breaking
  changes note). ✓
- `docs/business-decisions.md` — D1–D7 record the exact implemented behavior. ✓
- `docs/implementation-log.md` — milestones and verification evidence match repository state. ✓
- `docs/project-progress.md` — current status/HEAD/roadmap/risks truthful as of `cd3458e`. ✓

No documentation corrections required by this audit. **No doc changes are included in this
commit** beyond the audit report + progress update.

---

## 16. Git / Repository Hygiene

| Check | Result |
| ----- | ------ |
| Branch | `main` |
| Working tree | **Clean** at audit time |
| Origin sync | `main == origin/main` (`cd3458e3680910ac8ef246d3eeb893e02ec4bd5d`) |
| Secrets tracked | **None.** `.env` gitignored + untracked; no key material in tracked files |
| Generated files | `generated/prisma/` gitignored (correct); `*.tsbuildinfo`, `next-env.d.ts`, `.next/` ignored |
| Editor/agent dirs | `.agents/`, `.claude/`, `.windsurf/`, `skills-lock.json` ignored; `CLAUDE.md` tracked (one-line import of AGENTS.md) |
| Commit organization | Modular, well-labeled (`feat:`/`chore:`/`docs:`), all on `main` — clean linear history |
| Unnecessary tracked files | `public/*.svg` and scaffold favicon are harmless create-next-app remnants; `app/page.tsx`/`layout.tsx` scaffold UI unused by API-only backend (compound with “no UI” note — not a defect) |

No hygiene action required (beyond the audit commit itself).

---

## Findings

| ID | Severity | Area | Finding | Evidence | Why it matters | Recommended action | Migration? | Code change? | Status |
| -- | -------- | ---- | ------- | -------- | --------------- | ------------------ | :--------: | :----------: | ------ |
| **F-02** | **HIGH** | Concurrency | Stock availability check is read→check→write with no lock/no conditional update/no serializable isolation | `sale.service.ts:46-49,97`; `stock.service.ts:21-46`; no `isolationLevel`/`FOR UPDATE` in repo | Concurrent sales/adjustments can oversell last stock → negative stock, violating D6 | **FIXED (Milestone 7):** atomic conditional decrement via `ProductRepository.reserveStock` (`updateMany … stockQty.gte`) used for SALE + DAMAGE; `tests/concurrency/stock.ts` proves stock never goes negative; D6 reconciliation re-verified | NO | YES | FIXED |
| **F-01** | **HIGH** | Architecture/Validation | Products endpoint has no validation, bypasses service, casts `body as CreateProductInput` | `app/api/products/route.ts:18-19`; no `product.validation.ts` | Master data other modules price off can be invalid (negative prices, bad tiers) and errors become raw 500s | **FIXED (Milestone 8):** added `product.validation.ts` (price polarity, tier shape, duplicate-`minQty`, string caps, unknown-fields-ignored) and wired the route to validate before persist; `tests/unit/product.validation.ts` (30/30) + 13 HTTP checks green | NO | YES | FIXED |
| **F-03** | **HIGH** | Error handling/Security | 500 responses return raw `error.message`, contradicting the method’s own “never leaked” comment | `lib/response.ts:16-19` | Driver/DB internals leak to clients | **FIXED (Milestone 9):** generic 500 `{ "message": "Internal Server Error" }` for any non-`AppError`, details logged server-side; `tests/unit/error-response.ts` (11/11) + `tests/http/error-handling.ts` (12/12) incl. unreachable-DB leak-canary checks | NO | YES | FIXED |
| **F-10** | **HIGH** | Security | No authentication/authorization/roles anywhere | No middleware; no user model; all routes unguarded | Backend cannot be exposed beyond trusted network; blocks production | Design auth/roles decision; implement as a gated milestone | NO | YES | PLANNED (preexisting) |
| **F-04** | **MEDIUM** | Security/DoS | Unbounded sale quantity → `new Array(qty + 1)` allocation server-side | `product.service.ts:16`; `sale.validation.ts` has no upper bound | Unauthenticated large `quantity` → memory exhaustion | **FIXED (Milestone 10):** shared caps in `lib/bounds.ts` (`MAX_ITEM_QUANTITY=100000`, `MAX_ITEMS_PER_DOCUMENT=100`, `MAX_AMOUNT=10000000`) wired into all six validators; over-limit → 400 before allocation. `tests/unit/input-bounds.ts` (28/28) + `tests/http/input-bounds.ts` (11/11) incl. the documented `quantity: 1e8` payload rejected < 15 s | NO | YES | FIXED |
| **F-05** | **MEDIUM** | Database | No CHECK constraints (notably `stock_qty >= 0`) and no secondary indexes on report/FK columns | `schema.prisma`; `prisma/migrations/*` | Negative stock physically storable; report joins scan as tables grow | Add constraint via migration (or DB-level guard) + indexes on `(product_id, date)`, `date`/`source`, `customer_id`, `supplier_id` | YES | YES | OPEN |
| **F-06** | **MEDIUM** | Money | Float money arithmetic in services (running `grandTotal`, `qty × costPerUnit`) with rounding only for `pricePerUnit` | purchase.sale/purchase/service grand-total sums; no paisa-wide rounding helper | Float noise can enter stored Decimals beyond the documented D1 drift | Centralize paisa rounding on computed totals (int-paisa or round at boundary) | NO | YES | OPEN |
| **F-07** | **MEDIUM** | API | No pagination / search / filtering on any list endpoint; no update/void capability | `app/api/*` GET handlers return full tables; no PATCH/PUT/DELETE | Unbounded responses + no correction path for entry mistakes | Add pagination + search after P0/P1 fixes (roadmap already lists this) | NO | YES | OPEN |
| **F-08** | LOW | Validation | No upper bounds / max lengths on string fields; no explicit ID validation | validators check type/non-empty only | Trivially: oversized strings; low real-world impact | Add sane length caps when touching validation | NO | YES | OPEN |
| **F-09** | LOW | Reporting/Timezone | Date coercion is server-local; Postgres timestamps are naive `TIMESTAMP(3)` | `report.validation.ts:47-71`; migration DDL | Day boundaries shift with server TZ; fine single-host, needs a decision for shared hosting/multi-region | Record a timezone decision (store shop-local or TZ-aware) | MAYBE | NO | OPEN |
| **F-11** | LOW | Security | No CORS config, security headers, or rate limiting | `next.config.ts` empty; no middleware | Hardens against casual abuse once exposed; low urgency pre-auth | Add headers/limits as part of production hardening | NO | YES | OPEN |
| **F-12** | INFO | Type safety | Enum/Decimal `as` casts rely on DB guarantees | `wallet.repository`, `report.repository` enum casts | Acceptable; no invalid value reachable via DB enums | None (or tighten via `satisfies`) | NO | NO | ACCEPTED |
| **F-13** | INFO | Transactions | All 5 multi-step ops transactional & correct; balances atomic; no partial-state | §3 table | Foundation is sound | No action | NO | NO | OK |
| **F-14** | INFO | Financial/Inventory | Invariants hold by construction; only stock race (F-02) can break “never negative” | §10, §11 | Ledger soundness confirmed | Resolve via F-02 | NO | NO | OK |
| **F-15** | INFO | Testing | No automated tests; D1–D7 correctness rests on manual Postman+SQL | `package.json` (no test script); empty `tests/unit/` | Regression risk highest on concurrency & rollback paths | Add unit + integration + concurrency tests (see §14) in a P1 milestone | YES | YES | FIXED (Milestone 11) |
| **F-16** | INFO | Docs/Git | Documentation accurate; tree clean; main == origin/main; secrets untracked | §15, §16 | Audit baseline good | Keep going | NO | NO | OK |

Severity scale used: CRITICAL (none found) → HIGH → MEDIUM → LOW → INFO. No finding is
exaggerated; F-02/F-01/F-03/F-10 are the actionable HIGHs, and F-02 is the only one that can
corrupt *data* (and only under concurrent requests).

---

## Recommended Fix Order

### P0 — Must Fix Before Further Feature Development
1. **F-02 — FIXED (Milestone 7).** Atomic stock availability via conditional decrement
   (`ProductRepository.reserveStock`, `updateMany … stockQty.gte`) for SALE and DAMAGE, with
   `tests/concurrency/stock.ts` proving stock never goes negative. Remaining nuance: CORRECTION
   concurrency (last-writer-wins on target) remains out of scope and documented.
2. **F-01 — FIXED (Milestone 8).** `product.validation.ts` for `POST /api/products` wired into
   the route (price polarity, tier shape, duplicate-`minQty`, string caps); invalid payloads
   return 400. Unit tests (30/30) + 13 HTTP checks green.

Rationale: F-02 (stock integrity), F-01 (master data validation), F-03
(error privacy), F-04 (DoS input bounds), and F-15 (automated regression gate)
are done — every actionable HIGH plus the first two P1 findings are closed.
Remaining P1 findings (F-10, F-05) are next.

### P1 — Should Fix Before Production
3. **F-03 — FIXED (Milestone 9).** Generic 500 (no message/path/DB/host/port
   leakage) with server-side logging; unit suite (11/11) + HTTP suite (12/12)
   incl. unreachable-DB leak-canary proof.
4. **F-04 — FIXED (Milestone 10).** `lib/bounds.ts` shared caps
   (`MAX_ITEM_QUANTITY`, `MAX_ITEMS_PER_DOCUMENT`, `MAX_AMOUNT`) enforced in
   all six validators; over-limit input → 400 before `calculatePrice` is ever
   reached (the documented `quantity: 1e8` DoS payload returns 400 < 15 s).
   Unit (28/28) + HTTP (11/11) suites, incl. boundary-MAX success paths and a
   post-attempt liveness check.
 5. **F-10** — authentication/authorization decision + implementation (production blocker).
 6. **F-15 — FIXED (Milestone 11).** Full D1–D7 automated regression gate
    (`npm run test:all`, 17 suites / 197 assertions, 0 failures) against
    `erp_retail_test` only: unit (pricing 6/6, validators 30/30) + integration
    (sales 10/10, purchases 6/6, customer-payments 8/8, supplier-payments 5/5,
    stock 8/8, rollback 8/8, ledger 2/2, reports 2/2) + HTTP smoke 15/15, on top
    of the existing concurrency 5/5, unit 30/30, error 11/11, bounds 28/28,
    http error 12/12, http bounds 11/11 suites.
 7. **F-05** — DB CHECK constraint (`stock_qty >= 0`) + secondary indexes for report/FK joins.

### P2 — Important Quality Improvements
8. **F-06** — paisa-wide money rounding at computed-total boundaries.
9. **F-07** — pagination/search on list endpoints; error-correction (void) capability design.
10. **F-09** — record a timezone decision for report day-boundaries.

### P3 — Future Improvements
11. **F-08** — string length caps / ID format validation when validation is revisited.
12. **F-11** — CORS policy, security headers, rate limiting (as part of production hardening).
13. Route-boilerplate consolidation (shared JSON-parse/error shell); scaffold UI cleanup.

---

## Proposed Next Milestones

*(Planned only — NOT implemented in this audit. To be reviewed with the project manager.)*

1. **Milestone 7 — Concurrency hardening + atomic stock (F-02) — DONE.** Atomic conditional
   decrement for SALE + DAMAGE; `tests/concurrency/stock.ts` (5 scenarios) + 12 HTTP regression
   checks; D6 reconciliation re-verified. Tracking: GitHub issue ERP-001.
2. **Milestone 8 — Products layering + validation (F-01) — DONE.** Added
   `product.validation.ts` and wired the route; invalid payloads → 400;
   `tests/unit/product.validation.ts` (30/30) + 13 HTTP checks green.
   Tracking: GitHub issue ERP-002.
3. **Milestone 9 — Error privacy (F-03) — DONE.** Generic 500 with server-side
   logging (`lib/response.ts`); `tests/unit/error-response.ts` (11/11) +
   `tests/http/error-handling.ts` (12/12, unreachable-DB leak-canary proof).
   Tracking: GitHub issue ERP-003. (Note: audit draft grouped F-04 here; F-04
   is now a separate milestone.)
4. **Milestone 10 — Input upper bounds (F-04) — DONE.** `lib/bounds.ts` shared
   caps enforced in all six validators; over-limit → 400 before allocation.
   `tests/unit/input-bounds.ts` (28/28) + `tests/http/input-bounds.ts`
   (11/11, incl. the documented `quantity: 1e8` DoS payload rejected < 15 s
   and boundary-MAX success paths). Tracking: GitHub issue ERP-004.
5. **Milestone 11 — Automated regression suite — DONE.** Full D1–D7 gate
   against `erp_retail_test` only: unit (pricing 6/6, validators 30/30),
   integration (sales 10/10, purchases 6/6, customer-payments 8/8,
   supplier-payments 5/5, stock 8/8, rollback 8/8, ledger 2/2, reports 2/2),
   HTTP D1–D7 smoke 15/15, plus existing concurrency/bounds/error suites.
   `npm run test:all` green; dev DB (`erp_retail`) byte-identical before/after.
   Tracking: GitHub issue ERP-005.
6. **Milestone 12 — DB hardening** (F-05): CHECK constraint + targeted indexes + migration.
7. **Milestone 13 — Auth design + implementation** (F-10) — requires a business decision
   (roles/permissions) before code.
8. Continue with previously planned roadmap (pagination/search, dashboard, advanced
   reporting, production readiness).

---

*Audit evidence: full source inspection of `app/`, `lib/`, `modules/`, `prisma/`; `git log`;
`npx tsc --noEmit --incremental false` (exit 0); `npm run lint` (clean); `prisma validate` (valid);
Postman collection (58 requests / 9 folders) and SQL reconciliation results taken from
`docs/implementation-log.md` (prior live verification), cross-checked against the aggregation
queries actually present in `modules/reports/`. No load/concurrency test was executed during
this audit — F-02 severity is based on code + READ COMMITTED semantics.*