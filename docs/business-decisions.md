# Business Decisions

Decisions where real shop behavior overrides generic ERP conventions, or where an
architecture choice affects business meaning. Each entry follows the change-management
format from the master spec (§40): current behavior, proposed behavior, reason,
database impact, API impact, existing feature impact, testing impact.

---

## D1 — `SaleItem.pricePerUnit` is an effective (informational) unit price

**Status:** Accepted — 13 Aug 2026

**Current behavior (before)**
No per-unit price recorded on sales; historical price could not be reconstructed.

**Proposed behavior**
Each sale item stores the effective unit price charged at the time of sale:

```
pricePerUnit = SaleItem total / quantity, rounded to 2 decimals (paisa)
```

The authoritative value for any sale is `Sale.total` (sum of the min-cost bundle
calculation). `pricePerUnit` is informational and must **never** be recomputed from
`Product.currentPrice` later.

**Reason**
Tier/bundle pricing (e.g. 3 for 50) has no clean per-unit price. `50 / 3 = 16.67`
(rounded). This introduces a known representational drift of ≤ 3 paisa when
re-multiplied (`16.67 × 3 = 50.01`). This is accepted: the sale total is correct,
and the wallet/customer balances are driven by `Sale.total`, never by
`qty × pricePerUnit`. Adding an exact per-line `total` column was considered and
declined — no business need yet.

**Database impact:** none (existing `sale_items.price_per_unit` column).
**API impact:** none.
**Existing feature impact:** none.
**Testing impact:** pricing tests assert `Sale.total` (authoritative) AND
`pricePerUnit` (informational) independently.

---

## D2 — `Product.costPrice` is the current/latest reference cost, never historical

**Status:** Accepted — 13 Aug 2026

**Current behavior (before)**
`Product.costPrice` was set once at product creation and never updated by stock
movements.

**Proposed behavior**
When a purchase arrives:

```
PurchaseItem.costPerUnit   → immutable historical purchase cost
Product.costPrice          → updated to the latest purchase costPerUnit
Product.stockQty           → increased
```

Example: costPrice 18 → buy 100 × 20 → costPrice becomes 20; next buy 50 × 22 →
costPrice becomes 22.

**Reason**
The shop prices by latest buying cost. Historical purchases stay accurate through
`PurchaseItem.costPerUnit`; `Product.costPrice` is only a current reference used for
operational decisions and simple profit estimates.

**Important limitation (documented, not solved here):** this is NOT inventory
valuation or exact COGS accounting. If accurate COGS/profit with fluctuating
purchase prices is required later, choose an inventory costing method
(weighted average, FIFO, or LIFO) as a new decision before implementing reports.

**Database impact:** none (existing `products.cost_price` column; values now change).
**API impact:** `GET` product responses reflect the latest cost after each purchase.
**Existing feature impact:** none — product creation still sets the initial cost.
**Testing impact:** after a purchase, assert `Product.costPrice == latest costPerUnit`
and that earlier `PurchaseItem.costPerUnit` rows are untouched.

---

## D3 — Cash purchases must not inflate the wallet ledger

**Status:** Accepted — 13 Aug 2026

**Current behavior (before)**
No purchases module existed; wallet was only fed by sales-side deposits.

**Proposed behavior**
`paymentType = CASH` means the supplier was actually paid at purchase time, so the
cash box must be debited immediately, in the same database transaction:

| Purchase type          | Supplier balance | Wallet |
| ---------------------- | :--------------: | :----: |
| CASH                   |  no increase     | − purchase total |
| CREDIT                 | + purchase total |  no change |
| Later supplier payment | − payment amount | − payment amount |

- CASH purchase → `WalletTransaction(WITHDRAWAL, SUPPLIER_PAYMENT)` for the purchase
  total, atomically with the stock increase.
- CREDIT purchase → `Supplier.balanceOwed += total`, **no wallet transaction**.
- A later explicit `SupplierPayment` reduces the supplier balance and debits the
  wallet in its own transaction.

**Reason**
If a CASH purchase only increased inventory, the ERP would overstate cash by the
purchase amount. The wallet is the authoritative money ledger
(`balance = SUM(DEPOSIT) − SUM(WITHDRAWAL)`), so every real cash movement must be
recorded. `SUPPLIER_PAYMENT` is a distinct `WalletTxnSource` so supplier payouts are
never confused with shop expenses.

**Database impact:** `SUPPLIER_PAYMENT` added to the `WalletTxnSource` enum;
`Purchase.paymentType` added to distinguish CASH/CREDIT.
**API impact:** new `POST /api/purchases` and `POST /api/supplier-payments`.
**Existing feature impact:** none.
**Testing impact:** reconciliation invariant — for a CASH purchase,
`wallet decrease == purchase total` and supplier balance unchanged; for CREDIT,
`supplier balance increase == purchase total` and wallet unchanged.

---

## D4 — Customer overpayment becomes prepaid credit

**Status:** Accepted — 13 Aug 2026

**Current behavior (before)**
No customer payment flow existed; no notion of prepaid credit.

**Proposed behavior**
Customer payments may exceed the current `balanceOwed`. The balance is signed:

| balanceOwed | meaning |
| ----------- | ------- |
| `> 0`       | customer owes the shop |
| `= 0`       | nothing owed |
| `< 0`       | customer has prepaid / credit with the shop |

Example: owes 500 → pays 700 → `balanceOwed = -200`. That Rs. 200 stays as
customer credit and is applied against future CREDIT sales automatically, because
the sale logic adds it to a signed balance (`-200 + 100 = -100`).

Payment and balance updates remain atomic within the same transaction.

**Reason**
Rejecting legitimate situations (settling multiple debts at once, paying in
advance, intentionally leaving credit for future purchases) would harm the real
shop). A negative balance is customer credit, not an error.

**Database impact:** none (signed `customers.balance_owed` semantics only).
**API impact:** none — existing field carries the new meaning.
**Existing feature impact:** CREDIT-sale balance arithmetic already consumes
prepaid credit (signed add); no sale change required.
**Testing impact:** prepaid lifecycle test — owe 500, pay 700 → −200, CREDIT sale
100 → −100.

---

## D5 — Optional sale linkage for customer payments

**Status:** Accepted — 13 Aug 2026

**Current behavior (before)**
No customer payment flow existed.

**Proposed behavior**
`CreditPayment` optionally links to a specific CREDIT sale (`saleId` null for a
lump-sum). Before accepting a sale-linked payment the service verifies:

- the sale exists → else `404`
- `sale.customerId === payment.customerId` → else `400`
- `sale.paymentType === "CREDIT"` → else `400` (a CASH/ECASH sale is already
  paid at the counter; no credit payment may attach to it)

`saleId` is for traceability/reporting only — it does **not** change the balance
arithmetic (`balanceOwed -= amount` either way) and does **not** impose
amount-matching against the linked sale's remaining figure. Overpayment still
falls under D4.

**Reason**
Answers “which credit sale did this payment relate to?” while keeping lump-sum
settlements simple. Avoiding strict allocation keeps the ledger honest without an
allocation engine the shop does not need.

**Database impact:** none (`credit_payments.sale_id` already exists and is optional).
**API impact:** `saleId` is an optional body field on `POST /api/customer-payments`.
**Existing feature impact:** none.
**Testing impact:** valid CREDIT-sale link → 201; other-customer sale → 400;
nonexistent sale → 404; CASH-sale link → 400.

---

## D6 — Stock adjustment semantics and the audit baseline

**Status:** Accepted — 13 Aug 2026

**Current behavior (before)**
Stock only changed through Sales and Purchasing (each creating a StockMovement).
No manual adjustment path existed.

**Proposed behavior**
`POST /api/stock/adjustments` supports two reasons with **different** quantity
meanings:

| reason | quantity means | stock change |
| ------ | -------------- | ------------ |
| DAMAGE | amount damaged | `-quantity` |
| CORRECTION | desired final stock level | `target - current` |

Any adjustment whose result would be negative is rejected with a
`409 InsufficientStockError` before any database write.

**Baseline invariant.** Products are created with `stockQty = 0` and every stock
change must generate a `StockMovement`. Any initial physical stock must be entered
via a `CORRECTION` movement. Therefore this identity always holds:

```
Product.stockQty == Σ all StockMovement.qtyChange
```

for that product (opening baseline 0).

**Reason**
DAMAGE mirrors the shop's phrasing (“3 packets burst”); CORRECTION matches a
physical count (“system should say 25”), which avoids staff hand-computing deltas.
The signed `qtyChange` audit trail stays unambiguous, and the baseline rule keeps
the sum-of-movements invariant exact instead of leaving unexplained opening stock.

**Database impact:** none (existing `stock_movements` + `Product.stockQty`).
**API impact:** new `POST /api/stock/adjustments` and `GET /api/stock/movements`.
**Existing feature impact:** none — Sales and Purchasing behavior unchanged.
**Testing impact:** DAMAGE → negative movement; CORRECTION → `target − previous`;
failed adjustments leave both `Product` and `StockMovement` unchanged;
per-product `stockQty == Σ movements`.

---

## D7 — Reporting is a read-only derivation layer; exact report semantics

**Status:** Accepted — 13 Aug 2026

**Current behavior (before)**
Transactional data is only reachable per-record through the create/list
endpoints; there is no aggregate, date-range view.

**Proposed behavior**
Reports are computed **at request time** from the existing transactional tables.
The module never creates, updates, or deletes business records, and no aggregate
"report total" table is stored (nothing to synchronize).

Data sources per report:

| Report   | Source tables                                        |
| -------- | ---------------------------------------------------- |
| Sales    | `sales`, `sale_items`                                |
| Purchases| `purchases`, `purchase_items`, `suppliers`            |
| Stock    | `products`, `stock_movements`                        |
| Customers| `customers`, `credit_payments`                       |
| Suppliers| `suppliers`, `supplier_payments`                     |
| Wallet   | `wallet_transactions`                                |

**No COGS / valuation / profit.** Per D2's documented limitation, no inventory
costing method is applied. Value is reported as recorded revenue
(`sales.total`) and expense (`purchases.total`) only.

**Date-range filtering.** Every report whose source has a timestamp accepts
`from`/`to` (inclusive `from <= date <= to`). No filter = full history. Result
objects echo the applied range for provenance. Balances (stock/credit) are
point-in-time current values and ignore the date filter; only their associated
movement/payment histories are range-filtered.

**Exact calculations**

*Sales (`GET /api/reports/sales`)*
- `totalSales = Σ sales.total` — authoritative
- `numberOfSales = COUNT`
- `byPaymentType` — per `payment_type`: `count`, `total = Σ total`
- `productQuantities` — per product: `quantity = Σ qty`,
  `amount = Σ (qty × pricePerUnit)`. `amount` is a per-product allocation and
  carries the D1 ≤ 3 paisa per-sale drift; it is informational — report *totals*
  always come from `sales.total`.

*Purchases (`GET /api/reports/purchases`)*
- `totalPurchases = Σ purchases.total`, `numberOfPurchases = COUNT`
- `byPaymentType` — per `payment_type`
- `supplierTotals` — per supplier: `total = Σ purchases.total`

*Stock (`GET /api/reports/stock`)*
- `currentStock` — current `Product.stockQty` per product (always equals Σ full
  movement history by D6)
- `movementSummary` — per `reason`: `quantity = Σ qty_change`
  (PURCHASE ≥ 0, SALE/DAMAGE ≤ 0, CORRECTION ±), range-filtered, `count`

*Customers (`GET /api/reports/customers`)*
- `outstandingCredit = Σ balanceOwed` where `> 0`
- `prepaidCredit = −Σ balanceOwed` where `< 0` (reported positive, D4)
- `customers` — current signed `balanceOwed` per customer
- `paymentHistory` — per customer over range: `totalPaid = Σ amount`, `count`

*Suppliers (`GET /api/reports/suppliers`)*
- `outstandingBalance = Σ balanceOwed` where `> 0`
- `suppliers` — current `balanceOwed` per supplier
- `paymentHistory` — per supplier over range: `totalPaid = Σ amount`, `count`

*Wallet (`GET /api/reports/wallet`)*
- `deposits = Σ amount` (type DEPOSIT), `withdrawals = Σ amount` (WITHDRAWAL)
- `balance = deposits − withdrawals` within the reported range
- `bySource` — per `source`: `deposits`, `withdrawals`, `count`

**Reason**
Shop reporting needs aggregate, time-boxed views without duplicating the ledger.
Deriving on demand keeps one source of truth; inventing COGS/profit would
misrepresent true economics until a costing method is chosen (D2).

**Database impact:** none — read-only over existing tables.
**API impact:** new routes `GET /api/reports/sales|purchases|stock|customers|suppliers|wallet`.
**Existing feature impact:** none — no transactional code path touched.
**Testing impact:** each report value is re-derived by direct SQL and must match;
date filters shrink `totalSales`/`totalPurchases` to records in range; wallet/
customer/supplier/stock counts unchanged after report queries (read-only).

---

## D8 — Atomic stock availability via conditional decrement (F-02)

**Status:** Accepted — 13 Aug 2026

**Current behavior (before)**
Sales and DAMAGE checked stock with a read (`findById` → `stockQty` comparison)
before writing `stockQty` with an unconditional `increment`. Under Postgres
READ COMMITTED, two concurrent transactions could both pass the check and both
decrement — overselling the last unit and driving `stockQty` negative (audit
finding F-02, violating D6's never-negative rule).

**Proposed behavior**
A new repository primitive, `ProductRepository.reserveStock(id, qty)`, performs
an atomic **conditional decrement**:

```
UPDATE products
SET stock_qty = stock_qty - qty
WHERE id = <productId> AND stock_qty >= qty
```

The number of rows the UPDATE matches is the single authority for availability:

- match (1 row) → stock reserved, returns the updated product;
- no match → returns `null` → the service throws
  `InsufficientStockError` (HTTP 409) and the whole `$transaction` rolls back.

SALE (step 4 of `SaleService.createSale`) and DAMAGE
(`StockService.adjustStock`) now reserve through this primitive. Postgres
re-evaluates the `WHERE` clause against the latest committed row version when a
row was concurrently modified, so two racing writers on the last unit cannot
both win.

**Reason**
Stock must never go negative even under simultaneous counter requests; an
app-layer read-check-write cannot guarantee that, and a database CHECK
constraint alone would fail the whole transaction with an unhelpful 500. The
atomic conditional UPDATE is cheap, requires no schema change, and preserves
the one-transaction-per-operation boundary already in place.

**Scope note**
Only SALE and DAMAGE are hardened. **CORRECTION keeps the original
read→check→write path** — its `quantity` means a *desired final level*, so
concurrent CORRECTIONS are last-writer-wins on the target. This nuance is
documented and deliberately out of scope for F-02. A DB `CHECK (stock_qty >= 0)`
backstop is a separate finding (F-05), intentionally not bundled here.

**Database impact:** none (no schema/migration change; the primitive is a
conditional UPDATE on the existing `products.stock_qty`).
**API impact:** none on payloads/status codes — insufficient stock already maps
to `409 InsufficientStockError`, now also under concurrent requests.
**Existing feature impact:** none for sequential behavior; concurrent SALE/DAMAGE
can no longer oversell. Purchases and CORRECTION unchanged.
**Testing impact:** `tests/concurrency/stock.ts` (`npm run test:concurrency`)
runs 5 scenarios against the dedicated `erp_retail_test` database proving no
oversell, D6 reconciliation, and no wallet/customer/supplier side effects from
DAMAGE. Regression: `tsc`, `lint`, `prisma validate`, 12 HTTP checks.

---

## D9 — Authentication and roles (F-10)

**Status:** Accepted — 14 Aug 2026 (PM-approved; recorded before F-10 implementation)

**Architecture:** Authentication is delegated to **Better Auth** (self-hosted,
database-backed). Prisma/PostgreSQL remains the database; Better Auth owns
password hashing, sessions, cookies, login/logout, and user administration via
its Prisma adapter. Application-level authorization enforces the OWNER/CASHIER
role matrix (`admin` plugin, `defaultRole: "CASHIER"`, `adminRoles: ["OWNER"]`,
no Organization plugin). The original custom-auth design (interim commits
`653a8ba`/`33ef36d`) was superseded by PM approval and removed from history.

**Current behavior (before)**
No authentication, authorization, or user model anywhere. Every `/api/*` route
is unguarded; the audit finding F-10 blocks production exposure beyond a trusted
network.

**Proposed behavior**

**D9.1 — Identity source.** Local username + password only. No OAuth/SSO/external
identity provider, no MFA, no public sign-up. The owner manages all accounts
inside the app.

**D9.2 — Roles.** Exactly two: `OWNER` and `CASHIER`.

**D9.3 — Permission matrix.**

| Capability | OWNER | CASHIER |
| ---------- | :---: | :-----: |
| View products | ✅ | ✅ |
| Create/update product & pricing | ✅ | ❌ |
| View customers | ✅ | ✅ |
| Create customers | ✅ | ✅ |
| View suppliers | ✅ | ✅ |
| Create suppliers | ✅ | ❌ |
| Create sales | ✅ | ✅ |
| View sales | ✅ | ✅ |
| Customer payments | ✅ | ✅ |
| Stock adjustments | ✅ | ✅ |
| View stock movements | ✅ | ✅ |
| Create purchases | ✅ | ❌ |
| Supplier payments | ✅ | ❌ |
| Reports | ✅ (all 6) | ⚠️ sales + stock only |
| User management | ✅ | ❌ |
| Auth management | ✅ | ❌ |

CASHIER is the counter operator: sales, customer payments, stock
damage/correction, and reading master data. Purchasing (wholesale cost/supplier
exposure), supplier payouts, pricing, user management, and non-sales/stock
reports are owner-only — **purchase read for cashiers is explicitly rejected**;
any future grant is a separate D9 amendment.

**D9.4 — Passwords.** Minimum 8 characters. Hashing and verification are
**entirely delegated to Better Auth** (scrypt with per-user salt, cost
parameters embedded in the stored hash, NFKC normalization, constant-time
verification). No custom crypto code. Stored in Better Auth's `account.password`
(provider `credential`). No plaintext anywhere.

**D9.5 — Sessions.** Better Auth DB-backed sessions (opaque tokens, no JWT),
`expiresIn: 12h` with sliding `updateAge: 6h`, `HttpOnly` cookie
(`SameSite=Lax`, `Secure` in production, prefix `erp`). Immediate revocation:
logout, `banUser` (our DISABLED state), and password reset all invalidate active
sessions (`revokeUserSessions` after `setUserPassword`, which does not revoke on
its own).

**D9.6 — Report visibility.** OWNER can access all six reports. CASHIER can
access only the **sales** and **stock** reports (`/api/reports/sales`,
`/api/reports/stock`). CASHIER receives `403` for the supplier, purchases,
customers, and wallet reports.

**D9.7 — Invariant.** There must always be at least one active OWNER. The last
active OWNER cannot be banned/disabled/demoted; the service rejects the change.

**D9.8 — Route protection model.** Defense-in-depth. A coarse Next.js **proxy**
gate checks cookie presence only (no DB access, 401 without the cookie), while
every protected route handler performs the authoritative DB-backed
authentication and role authorization itself (`auth.api.getSession` + role
guard). A random/forged cookie passes the proxy but fails at the route with 401.

**D9.9 — Origin check.** On every state-changing ERP request
(POST/PUT/PATCH/DELETE), a present `Origin` header that does not match the
request's own origin is rejected before the session is touched; a missing
`Origin` (non-browser clients) is allowed. Defense-in-depth layered with
`SameSite=Lax`; deliberately not the F-11 security-header/rate-limit work.

**D9.10 — Email is internal.** Username login via Better Auth's username plugin
requires a unique email column on `user`; we derive `<username>@erp.local` for
every account. This internal value is **never exposed** through the ERP API —
responses return only `id`, `username`, `role`, and status fields.

**Reason**
A single-owner + cashiers shop needs counter access for staff without exposing
the owner's financial picture or the ability to move money to suppliers. Better
Auth gives audited, maintained auth primitives (password handling, sessions,
CSRF protection) at the right complexity level for a small ERP, keeping the
ledger invariants untouched.

**Database impact:** new `user`, `session`, `account`, `verification` tables
(Better Auth core schema, migration generated by `npx auth@latest generate`);
no change to existing tables or F-05 constraints.
**API impact:** Better Auth mounts at `/api/auth/*` (`[...all]` handler +
`proxy.ts`); new `POST /api/auth/sign-in`, `POST /api/auth/sign-out`,
`GET /api/auth/get-session` (auth framework endpoints), plus
`GET/POST /api/users`, `GET/PATCH/DELETE /api/users/[id]` (user admin);
all existing routes gain `401` (unauthenticated) / `403` (insufficient role)
guards; route paths, payloads, and success/validation status codes are unchanged.
**Existing feature impact:** none to services, ledger logic, or reconciliation
invariants; transactional behavior is identical once authenticated.
**Testing impact:** new unit, integration, and HTTP suites (login, 401/403
matrix, forged-cookie bypass, origin rejection, last-owner invariant) on the
existing Vitest infrastructure; existing HTTP suites log in as a fixture owner
first.

---

## D10 — Shop-local timezone for dates and reports

**Status:** Accepted — 14 Aug 2026

**Current behavior (before)**
Date handling ran in the server's UTC/ISO world. Naive `from`/`to` query params
on reports were coerced as UTC-midnight, so a "today" window expressed by the
shop (Asia/Kathmandu, UTC+05:45) could cover the wrong 24 hours of shop time.

**Proposed behavior**
The shop's timezone is configured at runtime via the `ERP_TIMEZONE` environment
variable (default `Asia/Kathmandu`), read from `process.env` — no
`next.config.ts` change.

- **Naive date-only query params** (`from`/`to` = `YYYY-MM-DD`) on report
  routes are interpreted as **shop-local wall clock**. `lib/timezone.ts`
  implements the Intl-offset technique: compute the shop's UTC offset for the
  given instant, then anchor to shop-local midnight (`naiveAsShopLocal`,
  `shopLocalDayStart`, `formatShopLocal` with the shop offset, e.g. `+05:45`).
- **Full ISO strings carrying an explicit zone** (`Z`, `±hh:mm`, `[IANA]`) parse
  as-is — explicit beats configuration.
- The report **`range` echo** shows the applied window as a shop-local offset
  string (`2026-08-14T00:00:00+05:45`), never `.toISOString()` (which lies in
  UTC).
- Component range validation rejects impossible dates (e.g. `2026-99-99` → 400)
  and inverted ranges (`from > to` → 400).

**Reason**
Retail day boundaries are defined by the shop's wall clock, not UTC. Without
this, date-range filtering and the echoed range can silently shift report
windows, and a naive `from=2026-08-14` would not mean "the 14th, shop time" to
the staff reading the report.

**Database impact:** none — no schema or migration (explicit D10 scope).
**API impact:** `GET /api/reports/*?from=YYYY-MM-DD&to=YYYY-MM-DD` interprets the
params in shop-local time; the `range` echo changes from UTC to shop-local
offset strings. No payload field changes.
**Existing feature impact:** none — ISO timestamps with an explicit zone and
date objects passed programmatically are unchanged.
**Testing impact:** `tests/unit/timezone.test.ts` — naive-as-shop-local,
shop-local day start, offset-string formatting, explicit-zone passthrough, and
impossible-date rejection.

---

## D11 — Integer-paisa domain money

**Status:** Accepted — 14 Aug 2026

**Current behavior (before)**
Money was `number` (IEEE-754 float) throughout the application layer,
converted to/from Postgres `DECIMAL` (rupees) at the repository boundary.
Fractions (tier prices, effective unit prices, report sums, balance
arithmetic) accumulated floating-point error line after line.

**Proposed behavior**
All money arithmetic inside the application domain is **integer paisa**.

- `lib/money.ts` — the single conversion point: `rupeesToPaisa`,
  `paisaToRupees`, `roundHalfUp`, `paisaFromDecimal` (Decimal → whole paisa),
  and `MAX_AMOUNT_PAISA = MAX_AMOUNT × 100`.
- **Input boundary:** validators convert rupees → paisa **once**
  (`rupeesToPaisa`). **Domain:** services, repositories, and reports do all
  math in whole paisa (a paisa is exact). **Persistence:** repositories write
  `paisaToRupees` → Postgres `DECIMAL` and read `paisaFromDecimal` (rupees stay
  in the database — no migration). **Output boundary:** routes convert
  paisa → rupees through `to*Api` mappers; the API/report JSON shape and rupee
  denomination are unchanged.
- Rounding is **round-half-up, applied exactly once** at the rupee→paisa input
  conversion; downstream math is integer and needs no rounding. The only
  division is `SaleItem.pricePerUnit = Math.round(totalPaisa / quantity)`,
  still informational per D1.
- Caps preserved with identical message wording: `MAX_AMOUNT`,
  `MAX_ITEM_QUANTITY`, `MAX_ITEMS_PER_DOCUMENT`; the paisa layer is additionally
  guarded by `MAX_AMOUNT_PAISA`.

**Reason**
Floating-point money cannot represent paisa exactly (0.29 is not 29/100 in
binary), so per-line and per-report sums drift. Integer paisa is exact across
the entire domain and, at 100 paisa/rupee, stays safely below `2^53` even at
the documented caps — the F-04 bounds remain meaningful.

**Database impact:** none — `DECIMAL` columns keep storing rupees; no migration.
**API impact:** none to payload shape or denomination (rupees in, rupees out);
rounding is exact.
**Existing feature impact:** `SaleItem.pricePerUnit` is now the exact paisa
quotient (D1 drift ≤ 1 paisa per sale vs ≤ 3 paisa before); report totals are
whole-paisa sums converted to rupees once at payload construction.
**Testing impact:** `tests/unit/money.test.ts` (12 tests); integration/unit
suites assert paisa domain values where they call services/repositories, while
HTTP and report rupee expectations are unchanged (verified over real HTTP).

---

## D12 — Cursor-based pagination, search, and filtering (F-07)

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
All `GET /api/*` list endpoints return full unbounded JSON arrays. As data grows,
response sizes scale linearly with row count, there is no search or filtering
capability, and clients have no way to page through results.

**Proposed behavior**
Every list endpoint gains **optional** cursor-based pagination, text search, and
attribute filtering via query parameters. The change is fully backward compatible:

**Option A — backward compatibility.**
- No pagination params → existing raw-array response (unchanged shape).
- Any pagination param present → `{ data: T[], paging: PagingMeta }` envelope.

**Cursor design.**
- Cursor encodes `(date, id)` as a base64url string: `date_iso|uuid`.
- Ordering: `date DESC, id DESC` for date-ordered endpoints; `createdAt DESC, id DESC`
  for master-data endpoints (products, customers, suppliers).
- The `(date, id)` pair ensures deterministic ordering even when multiple rows
  share the same timestamp.

**Query parameters (all optional).**

| Param | Type | Default | Max | Description |
| ----- | ---- | ------- | --- | ----------- |
| `cursor` | string | — | — | Opaque cursor from previous response's `paging.next` |
| `limit` | integer | 50 | 500 | Page size |
| `search` | string | — | — | Case-insensitive substring match on `name` (master-data) or `id` prefix (transactional) |
| `paymentType` | string | — | — | Filter by payment type (sales, purchases) |
| `categoryId` | string | — | — | Filter by product category |
| `supplierId` | string | — | — | Filter by supplier (purchases, supplier-payments) |
| `customerId` | string | — | — | Filter by customer (customer-payments) |
| `productId` | string | — | — | Filter by product (stock-movements) |
| `reason` | string | — | — | Filter by stock reason (stock-movements) |

**Response envelope (when pagination params present).**
```json
{
  "data": [...],
  "paging": {
    "next": "base64url_cursor | null",
    "hasMore": true | false
  }
}
```

`next` is `null` when `hasMore` is `false` (last page).

**Filtering rules.**
- Filters are AND-combined.
- `search` is a case-insensitive `ILIKE %term%` on the relevant name column.
- Invalid query parameters (non-integer limit, unknown params) → `400`.
- `limit` below 1 or above 500 → clamped to bounds.

**Reason**
Unbounded list responses will not scale; the shop needs to browse products,
customers, and transaction history without loading entire tables. Cursor-based
pagination avoids the N+1 and offset-drift problems of offset pagination, and
the backward-compatible envelope lets existing (and future) API consumers
opt in incrementally.

**Database impact:** none — no schema migration, no new indexes. Pagination uses
the existing `(date, id)` and `(createdAt, id)` column combinations already
covered by primary keys and existing indexes. Performance analysis is a
separate step.

**API impact:** `GET /api/products`, `GET /api/sales`, `GET /api/purchases`,
`GET /api/suppliers`, `GET /api/customers`, `GET /api/supplier-payments`,
`GET /api/customer-payments`, `GET /api/stock/movements` all gain optional
pagination/search/filter query params. No params = same raw-array shape.

**Existing feature impact:** none — existing clients that do not send pagination
params see the exact same response. No service business logic, no transactional
code, no report logic is changed.

**Testing impact:** `tests/unit/pagination.test.ts` (cursor encoding/decoding,
identical-timestamp tiebreaker, page boundaries, invalid params, filter
combinations); `tests/http/pagination.test.ts` (backward-compat raw arrays,
envelope shape, cursor traversal, filter behavior over real HTTP); existing
test suites unchanged and green.

---

## D18.1 — Void authorization: OWNER only

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
No void/correction capability exists. All transactions are immutable once created.

**Proposed behavior**
Only OWNER can void transactions. CASHIER cannot void any transaction.

- `POST /api/{entity}/{id}/void` requires OWNER role.
- CASHIER requests receive the existing `403 Forbidden` response.
- No `createdBy` field added to transaction models (not needed for OWNER-only).
- Future permission system can introduce granular void permissions if needed.

**Reason**
Void operations reverse financial, stock, and transactional effects. The first
implementation must be conservative. OWNER-only avoids the complexity of
tracking which user created each transaction.

**Database impact:** new `VoidRecord` table (D18.7).
**API impact:** new `POST /api/{entity}/{id}/void` endpoints (OWNER-only).
**Existing feature impact:** none — existing routes unchanged.
**Testing impact:** authorization tests verify CASHIER receives 403 for void
requests.

---

## D18.2 — Void time window: no limit

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
No void capability exists.

**Proposed behavior**
A valid transaction may be voided regardless of how old it is. No time-window
validation.

- Do not add time-window validation logic.
- Use `ERP_TIMEZONE` only for timestamps/reporting where already required.
- Keep the original transaction date unchanged.
- Record the actual void timestamp separately in `VoidRecord.voidedAt`.

**Reason**
This is a small-shop ERP. Historical mistakes may only be discovered later.
There is no requirement for same-day or configurable time restrictions.

**Database impact:** none.
**API impact:** none.
**Existing feature impact:** none.
**Testing impact:** void tests do not assert any time-window behavior.

---

## D18.3 — Void granularity: transaction-level, all-or-nothing

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
No void capability exists.

**Proposed behavior**
Void is transaction-level and all-or-nothing. No partial voiding of individual
SaleItems or PurchaseItems in M18.

Example: A sale with Product A × 5 and Product B × 3 — the user cannot void
only Product A. The entire Sale is either ACTIVE or VOIDED.

Correction workflow:
1. Void the incorrect transaction (entire transaction).
2. Create a new correct transaction.

Transactions remain immutable; correction happens through void + new transaction.

**Reason**
Keeps accounting, stock, wallet, and reporting invariants manageable. Avoids
introducing line-level correction complexity. If a transaction was entered
incorrectly, the intended workflow is void + re-enter.

**Database impact:** none.
**API impact:** none.
**Existing feature impact:** none.
**Testing impact:** void tests verify entire transaction is voided, not individual
items.

---

## D18.4 — Linked CreditPayment handling: manual void required

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
No void capability exists.

**Proposed behavior**
A Sale with active linked CreditPayment records cannot be voided until those
CreditPayments have been voided first. Do NOT automatically void linked
CreditPayments when voiding a Sale.

Required dependency order:
```
CreditPayment(s) → Sale
```

Example: Sale = Rs. 500 CREDIT. Customer later pays Rs. 500. Attempt to void
Sale → BLOCKED. Void the CreditPayment first, then void the Sale.

Validation before Sale void:
- Query for active CreditPayments where `saleId = sale.id`.
- If any active linked CreditPayment exists, reject with `BusinessRuleError`.
- Already-voided CreditPayments do not block the Sale.

**Reason**
Do not silently modify a customer's payment history. Every financial correction
must be an explicit user action. Keeps the audit trail clear. Avoids cascading
hidden void operations.

**Database impact:** none.
**API impact:** error message tells the user which CreditPayments must be voided
first.
**Existing feature impact:** none.
**Testing impact:** tests verify: Sale with linked CreditPayment → void blocked;
after voiding CreditPayment → Sale void succeeds.

---

## D18.5 — Purchase costPrice recalculation

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
`Product.costPrice` is set to the latest purchase's `costPerUnit` (D2). No
weighted average. No historical cost tracking beyond `PurchaseItem.costPerUnit`.

**Approved behavior — Option A (cost-price re-derivation, 15 Aug 2026)**
When a Purchase is voided, `Product.costPrice` is recalculated from the latest
remaining NON-VOIDED `PurchaseItem.costPerUnit`.

- `costPrice = latest non-voided PurchaseItem.costPerUnit` per product, where
  "latest" follows the existing D2 ordering (latest purchase first).
- If NO valid purchase history remains for the product (every purchase voided),
  set `costPrice = 0`.
- Do NOT simply subtract the voided purchase's contribution from the current
  `costPrice`; do NOT invent weighted averages. The recalculation derives from
  the remaining non-voided purchase history.
- This is safe because D2 stores the full `PurchaseItem.costPerUnit` history
  immutably — the source of truth for the re-derivation already exists.

Investigation result (15 Aug 2026): the D2 methodology is fully reversible. The
only `costPrice` write paths are `ProductService.updateCostPrice` (via
`PurchaseService.createPurchase`, latest cost wins). Recomputing from remaining
non-voided `PurchaseItem` rows requires no new schema and no heuristic matching:
a product's non-voided purchase history is simply `PurchaseItem` rows joined to
`Purchase` rows that carry no `VoidRecord(targetType='PURCHASE')`.

**Reason**
The cost price must remain meaningful after a void. Simply leaving the old value
would be incorrect if the voided purchase was the one that set it.

**Database impact:** none (recalculation uses existing `PurchaseItem.costPerUnit`).
**API impact:** `Product.costPrice` reflects the recalculated value after void.
**Existing feature impact:** cost price behavior changes only when a purchase is
voided.
**Testing impact:** tests verify costPrice recalculation after purchase void.

---

## D18.6 — Stock safety: void must never create negative stock

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
D6 invariant: `Product.stockQty` must never be negative. DAMAGE uses atomic
`reserveStock` (F-02). CORRECTION rejects if result < 0.

**Proposed behavior**
A void operation must never cause `Product.stockQty` to become negative. If
reversing a transaction would make any affected Product's `stockQty < 0`, the
void must be rejected.

Example: Current stock = 5. Original Purchase added = 10. Voiding Purchase
would require stock -= 10, result = -5. → BLOCK void.

Validation requirements:
- Validate stock impact before completing the void.
- Use atomic/concurrency-safe stock updates consistent with F-02.
- If any affected product fails the stock safety condition, the entire void
  fails.
- Do not introduce a physical maximum stock constraint (current ERP has none).

For stock-adjustment voids:
- Reverse the original adjustment.
- If the reversal would produce negative stock, reject it.

**Reason**
Negative stock violates D6 and would corrupt the inventory invariant. The
existing F-02 approach (atomic conditional updates) provides the safety net.

**Database impact:** none.
**API impact:** `409 InsufficientStockError` when void would cause negative stock.
**Existing feature impact:** none.
**Testing impact:** tests verify: void blocked when stock would go negative;
void succeeds when stock remains >= 0.

---

## D18.7 — Audit trail: VoidRecord only

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
No void capability exists.

**Proposed behavior**
Use `VoidRecord` only for M18. Do NOT create `ReversalRecord` in M18.

`VoidRecord` fields:
- `id` (String, cuid)
- `targetType` (String: "SALE" | "PURCHASE" | "CREDIT_PAYMENT" | "SUPPLIER_PAYMENT" | "STOCK_MOVEMENT")
- `targetId` (String: ID of the original record)
- `reason` (String: user-provided reason)
- `note` (String, optional)
- `voidedBy` (String: userId from session)
- `voidedAt` (DateTime, default now)

Unique constraint: `(targetType, targetId)` — prevents double void.

**Reason**
VoidRecord provides sufficient auditability for the current shop scale. A
separate ReversalRecord table adds complexity without immediate business value.
The actual reversal must still be performed atomically and deterministically.

**Database impact:** new `VoidRecord` table with unique constraint.
**API impact:** void responses include `voidId` and `voidedAt`.
**Existing feature impact:** none.
**Testing impact:** tests verify: VoidRecord created on void; double void blocked
by unique constraint.

---

## D18.8 — Report treatment: exclude voided records

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
Reports include all records. No void capability exists.

**Proposed behavior**
Voided transactions must be excluded from normal reports. Reports represent
active business activity, not cancelled/voided activity.

Required exclusions:
- Sales reports: exclude voided Sales.
- Purchase reports: exclude voided Purchases.
- Customer balances: exclude voided CreditPayments.
- Supplier balances: exclude voided SupplierPayments.
- Stock reports: exclude voided StockMovements.
- Wallet/report calculations: exclude wallet transactions whose originating
  transaction has been voided, using explicit schema relationships.

**CRITICAL SCHEMA GAP (must resolve before implementation):**
WalletTransaction currently lacks `purchaseId`. CASH purchase wallet
transactions (source = SUPPLIER_PAYMENT) cannot be reliably identified for
exclusion without this field. The note field (`Purchase {id}`) is not a
reliable financial relationship.

Required before implementation:
- Add `purchaseId` to WalletTransaction (D18.10).
- Verify every wallet transaction source relationship.
- If a report cannot reliably determine whether a WalletTransaction belongs to
  a voided transaction, STOP and report the exact gap.

D7 remains valid: reports are read-only derivations over transactional data.

**Database impact:** WalletTransaction gains `purchaseId` FK (D18.10).
**API impact:** report values exclude voided activity.
**Existing feature impact:** report totals change when voided records exist.
**Testing impact:** tests verify: voided sale excluded from sales report;
voided purchase excluded from purchase report; wallet balance excludes voided
wallet transactions.

---

## D18.9 — API visibility: voided records remain visible

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
All records are returned as-is in list/detail endpoints. No status concept.

**Proposed behavior**
Voided records remain visible in normal list/detail APIs. They must NOT
disappear. API responses expose:
- `status: "ACTIVE" | "VOIDED"` (derived from VoidRecord existence)
- `voidedAt` (optional, when voided)
- `voidReason` (optional, when voided)

Default behavior:
- Existing records with no VoidRecord → `ACTIVE`
- Records with matching VoidRecord → `VOIDED`

Do NOT silently remove voided transactions from normal API responses.

**Reason**
Users need to see that a transaction was voided (audit trail). Disappearing
records would be confusing. A future filter can be introduced, but M18 should
at minimum expose status.

**Database impact:** none (status is derived, not stored).
**API impact:** all transaction list/detail endpoints include `status` field.
**Existing feature impact:** API responses gain a new `status` field (backward
compatible — existing clients ignore unknown fields).
**Testing impact:** tests verify: voided record has `status: "VOIDED"`; active
record has `status: "ACTIVE"`.

---

## D18.10 — Schema gap: WalletTransaction origin FKs (purchaseId, supplierPaymentId)

**Status:** Accepted — 15 Aug 2026 (amended 15 Aug 2026 by M18 approval)

**Current behavior (before)**
`WalletTransaction` has `saleId` (for source = SALE) and `creditPaymentId`
(for source = CREDIT_PAYMENT), but no `purchaseId` and no `supplierPaymentId`.
CASH purchase wallet transactions (source = SUPPLIER_PAYMENT) are identified
only by `note: "Purchase {id}"`; SupplierPayment wallet transactions are
identified only by `note: "SupplierPayment {id}"`.

**Approved behavior — explicit origin FKs (no note-based matching)**
Add BOTH nullable FKs to `WalletTransaction`:
- `purchaseId` (String?, FK to `Purchase.id`)
- `supplierPaymentId` (String?, FK to `SupplierPayment.id`)

`WalletTransaction` then identifies its origin via exactly one of:
`saleId | purchaseId | creditPaymentId | supplierPaymentId`. New indexes on
`purchaseId` and `supplierPaymentId`.

No wallet-linked transaction is ever matched by note text, amount, date, or
source heuristics. Financial reversal and report exclusion use the explicit FK.

**Reason**
The note field is not a financial relationship. SupplierPayment voids must not
rely on `note: "SupplierPayment {id}"` matching; the wallet origin must be a
first-class FK so void reversal, report exclusion, and reconciliation are
deterministic.

**Database impact:** `WalletTransaction` gains `purchaseId` and
`supplierPaymentId` (String, optional, FKs). New indexes on both.
**API impact:** none (internal relationships only).
**Existing feature impact:** `PurchaseService.createPurchase` sets `purchaseId`
when paymentType = CASH; `SupplierPaymentService.createSupplierPayment` sets
`supplierPaymentId`. Wallet notes remain for human readability only.
**Testing impact:** tests verify: CASH purchase wallet transaction has
`purchaseId` set; SupplierPayment wallet transaction has `supplierPaymentId`
set; voids reverse the correct wallet transaction via the FK.

---

## D18.11 — Concurrency: atomic void with unique constraint protection

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
No void capability exists. Existing transactions use `$transaction` for
multi-step operations (Sale, Purchase, CustomerPayment, SupplierPayment,
StockAdjustment).

**Proposed behavior**
All void operations must be atomic. The implementation must prevent:
- Double void (unique constraint on `VoidRecord(targetType, targetId)`)
- Void + payment race (CreditPayment created while Sale is being voided)
- Void + stock modification race
- Partial reversal where some side effects succeed and others fail

Use the existing Prisma `$transaction` pattern. The VoidRecord unique constraint
provides primary protection against duplicate voids. Additionally, the void
service should verify the target is not already voided before beginning the
transaction (defense-in-depth).

**Reason**
Financial operations must be atomic. Partial voids would corrupt invariants.

**Database impact:** unique constraint on VoidRecord (D18.7).
**API impact:** `409 ConflictError` on double void attempt.
**Existing feature impact:** none.
**Testing impact:** tests verify: concurrent void attempts → only one succeeds;
void with concurrent CreditPayment creation → proper error handling.

**Resolution (15 Aug 2026) — SELECT ... FOR UPDATE sale-row lock**

The unique constraint alone does not close the void + payment race: two
READ COMMITTED transactions that both *read* a Sale and then write their
VoidRecord / CreditPayment can each see the other's pre-write state and both
commit — producing an active CreditPayment on a voided Sale (the D18.4-forbidden
state). Ledger invariants (D3/D4/D6/wallet) still hold in that state, which is
why the regression suite asserts the Sale/CreditPayment/VoidRecord triangle
directly.

Fix: both sides acquire an exclusive row lock on the same `sales` row before
reading the sale's void/linked-payment state, via
`SELECT id FROM sales WHERE id = $1 FOR UPDATE` (`tx.$queryRaw`, shared helper
`lib/locks.ts`):

- `VoidService.voidSale` — locks the sales row, then checks the linked
  CreditPayment state; a payment committed by the other transaction is seen.
- `CustomerPaymentService.createCustomerPayment` (when `saleId` is set) — locks
  the sales row, then checks the VoidRecord; a void committed by the other
  transaction is seen.

The lock is taken inside the existing `$transaction`; the loser blocks on the
lock and then rejects against the winner's committed state. Deadlock is
impossible here: both transactions lock one Sale row in the same order. The
lock also serializes concurrent double-void attempts (the loser still hits the
unique constraint → 409), so no check was weakened.

**Testing:** `tests/concurrency/void-payment.test.ts` (F-08) races
`voidSale` vs `createCustomerPayment` on a fresh CREDIT sale 12× per run with
`Promise.allSettled`, asserting exactly one of the two succeeds and the loser
rejects with the expected business rule, no active CreditPayment ever sits on a
voided Sale, and the void-aware D3/D4/D6/wallet `reconcile()` stays clean.
Proven against the regression: with the locks removed the suite fails
immediately (both operations succeed, `ok.length === 2`).

---

## D19.1 — Rate limiting: process-local fixed-window (F-08)

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
Sign-in has no attempt cap (unlimited password guessing) and authenticated users
can issue unlimited state-changing API requests.

**Approved behavior**
Process-local fixed-window rate limiting in `lib/rate-limit.ts`, two scopes:

- **Auth scope** — `consumeAuthAttempt(req)`, keyed by client IP (left-most
  `x-forwarded-for` when present, else an `unknown` sentinel). Applied only to
  the credential-verification endpoints (`/api/auth/sign-in/email`,
  `/api/auth/sign-in/username`). Default **20 attempts per 15 minutes**; exceed
  → 429. Session/lifecycle endpoints (`get-session`, `sign-out`) are
  deliberately unlimited so legitimate flows are never disrupted.
- **API scope** — `consumeApiRequest(userId, method)`, keyed by authenticated
  user id. Applied **only to state-changing methods** (POST/PUT/PATCH/DELETE);
  GET reads are never limited. Wired into `requireUser` in
  `lib/auth/authorize.ts`, so every guarded route is covered at the single
  authorization choke point. Default **300 write requests per 60 seconds**;
  exceed → 429.

Both scopes are configured at call time via `ERP_RATE_LIMIT_AUTH_MAX`,
`ERP_RATE_LIMIT_AUTH_WINDOW_MS`, `ERP_RATE_LIMIT_API_MAX`,
`ERP_RATE_LIMIT_API_WINDOW_MS` (documented in `.env.example`).

**Deployment model (documented limitation):** the counters are in-memory and
per-process. The ERP deploys as a single Next.js process, where the counts are
exact. If the backend ever scales to multiple instances, this module must be
replaced with a shared store (e.g. Redis) — the counts must not be treated as
global across instances.

**Reason**
Brute-force protection for sign-in and a per-user cap on write requests without
adding infrastructure. Fixed windows are deterministic and cheap.

**Database impact:** none (counters are in-memory).
**API impact:** `RateLimitError` (429, `"Too many requests"`) is added to the
error taxonomy and rendered via the existing `toHttpResponse`.
**Existing feature impact:** no route is limited unless it is a sign-in path or
an authenticated state-changing request under the default caps.
**Testing impact:** `tests/unit/rate-limit.test.ts`; `tests/http/rate-limit.test.ts`
spawns a dev server with low caps and proves: sign-in blocks after N attempts,
API write requests block after N, reads stay 200 after a block, and the config
is read from the environment.

---

## D19.2 — Security headers + strict CSP + no-CORS (F-11)

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
No security headers are emitted. No explicit CORS policy exists (no
`Access-Control-Allow-*` header is produced, but this is not stated as policy).

**Approved behavior**
`next.config.ts` `headers()` emits:

- **Baseline on every route** (`/:path*`): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`.
- **JSON API additionally** (`/api/:path*`):
  `Content-Security-Policy: default-src 'none'; base-uri 'none';
  frame-ancestors 'none'` and `Cross-Origin-Resource-Policy: same-origin` — a
  strict CSP is
  safe for a pure JSON API (no scripts/styles) and `CORP: same-origin` stops
  cross-origin embedding.
- **CORS is deliberately disabled as policy**: no `Access-Control-Allow-*`
  header is ever emitted, so browsers enforce same-origin for reads AND writes.
  The app-level `assertSameOrigin` (D9.9) additionally rejects state-changing
  requests carrying a foreign `Origin` (absent Origin — non-browser clients — is
  allowed), so the no-CORS policy is enforced at both layers.

**Reason**
Hardening the HTTP surface per F-11 without a CORS allow-list: the API has no
cross-origin consumers, so the strongest policy (no CORS at all) is also the
simplest to keep correct.

**Database impact:** none.
**API impact:** every response gains the baseline headers; `/api/*` gains the
strict CSP + CORP. No behavioral change to status codes or bodies.
**Existing feature impact:** none — browsers only.
**Testing impact:** `tests/http/security-headers.test.ts` asserts the baseline
on the scaffold page, the strict CSP/CORP on API and better-auth responses, and
that no `access-control-*` header is ever emitted.

---

## D19.3 — Route identifier format validation (P3)

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
Route params (`[id]`) are passed straight to the repository. A malformed
identifier such as `not-a-uuid` reaches Prisma and surfaces as a 500.

**Approved behavior**
`lib/validate.ts`:

- `assertUuid(value, field?)` — structural `8-4-4-4-12` hex check. Deliberately
  **not** version/variant-restricted: any well-formed UUID string is a valid
  route key (pre-existing behavior treats the all-zeros UUID as a valid-looking
  key that resolves to 404); only non-UUID garbage is rejected.
- `assertUserId(value, field?)` — UUID **or** the Better Auth 32-char
  `[a-zA-Z0-9]` id, because users created through the API carry 32-char ids
  while seeded users carry UUIDs. Applied to `/api/users/*` routes only.
- Rejections throw `ValidationError` → **400**.

Wired into all 14 `[id]` route files (`products`, `customers`, `suppliers`,
`sales`, `purchases`, `stock/movements/[id]/void`, the three payment/void
routes, and `users/[id]` + ban/unban/reset-password).

**Reason**
Malformed identifiers are client error (400), not server fault (500), and the
boundary check keeps Prisma from seeing garbage keys.

**Database impact:** none.
**API impact:** malformed ids in paths → 400 with a clear message instead of 500.
**Existing feature impact:** all valid ids (UUIDs and 32-char user ids) are
accepted unchanged.
**Testing impact:** `tests/unit/validate.test.ts`; two hostile-path cases in
`tests/http/input-bounds.test.ts` (malformed entity id and malformed user id →
400, not 500, with the liveness check still green afterwards).

---

## D19.4 — Last-active-OWNER concurrency (P4)

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
The D7 last-active-OWNER guard (`assertNotLastActiveOwner`) is a read-then-write
sequence, and Better Auth performs the write (`setRole`/`banUser`/`removeUser`)
in its own transaction that the ERP service cannot join. Two concurrent
demotions (or bans/deletions) of each other by two OWNERs can both read `N = 2`
active OWNERs, both pass the guard, and both commit — leaving **zero** active
OWNERs. Postgres row locks cannot span the check and the mutation.

**Approved behavior**
A process-local async mutex (`lib/mutex.ts` `AsyncMutex`) serializes the
guard-and-mutate critical section in `UserService.updateRole` / `deleteUser` /
`banUser` (single `ownerGuardMutex`). Whichever operation runs first commits its
change; the second re-checks the count against the committed state and is
rejected. `unbanUser` is deliberately unguarded — unbanning cannot reduce the
active-OWNER count.

**Deployment model (documented limitation):** the mutex is process-local and
correct for the single-process deployment. A multi-process deployment would
need a distributed lock (e.g. Redis).

**Reason**
The invariant (D7: at least one active OWNER must always remain) must hold under
concurrency; the mutex closes the race without weakening the guard.

**Database impact:** none.
**API impact:** none (serialization only).
**Existing feature impact:** none.
**Testing impact:** `tests/unit/mutex.test.ts`; `tests/concurrency/last-owner.test.ts`
races cross-demotions, cross-bans, and cross-deletions by two OWNERs with
`Promise.allSettled`, asserting exactly one succeeds and exactly one active
OWNER remains (and one user for the deletion scenario).

---

## D20 — Data export as a serialization of the D7 report layer (M20)

**Status:** Accepted — 15 Aug 2026

**Current behavior (before)**
The six reports exist only as JSON over `GET /api/reports/*`. The shop has no
way to hand daily sales/purchase/supplier/customer/wallet data to the
accountant or to archive it as files.

**Proposed behavior**
Six read-only export endpoints, one per report:

| Export | Route | Roles (D20.3) |
| ------ | ----- | ------------- |
| Sales | `GET /api/exports/sales` | OWNER, CASHIER |
| Stock | `GET /api/exports/stock` | OWNER, CASHIER |
| Purchases | `GET /api/exports/purchases` | OWNER |
| Customers | `GET /api/exports/customers` | OWNER |
| Suppliers | `GET /api/exports/suppliers` | OWNER |
| Wallet | `GET /api/exports/wallet` | OWNER |

An export is a **serialization of the exact D7 report payload** the matching
`/api/reports/{name}` endpoint returns — the export module never computes its
own figures and never touches the database, so the D7 derivation and the D18.8
void exclusion stay byte-identical to the report endpoints. Query params:
`from`/`to` use the same D10 report range semantics (coerced naive dates,
shop-local parsing, range echo), and `format=csv|json` selects the file format
(default `csv`).

**D20.1 — CSV format.** Comma separator, RFC-4180 double-quote escaping, CRLF
row terminator, UTF-8 with a byte-order mark so Excel renders non-ASCII values
(Nepali names, ₹ symbols) correctly. JSON exports are UTF-8 without a BOM.
CSV document layout (deterministic): a metadata block (`Report`, `From`, `To` —
the D10 range echo) followed by one table per report section; each table is a
single-cell title row, a header row, then data rows. Money and quantities are
plain numbers (rupees, D11). A text-only CSV-injection guard prefixes cells
that begin with a formula-trigger character (`=`, `+`, `-`, `@`, tab, CR) with a
single quote; numeric cells are always emitted bare, so negative balances
(e.g. -120 prepaid credit) are never mangled.

**D20.2 — Full-range, streamed exports.** Exports include **every record
matching the requested filters/range**, independent of the normal 50-row API
pagination cap — exports are never truncated at page size. Response bodies are
streamed (one chunk per CSV row / JSON element) rather than materialized as a
single in-memory string; no artificial row cap is applied. The only in-memory
form is the report payload the report service already builds (inherent to the
D7 derivation).

**D20.3 — Authorization reuses the D9.6 report rules.** CASHIER may export
exactly the report types they are already permitted to view (sales, stock);
OWNER retains full export access. There is no separate ADMIN role or export
permission matrix. Existing controls apply consistently: exports are `GET`
requests and are never rate-limited (F-08), the `requireRole` guards run the
DB-backed session check (D9.8) and the same-origin gate (D9.9) is unchanged.

**Reason**
The accountant-facing need is "the same numbers the reports show, as a file".
Deriving exports from the report layer (D7) makes drift impossible, needs no
schema change, and keeps every ledger/stock invariant untouched. Excluding
voided activity is inherited from the reports (D18.8).

**Database impact:** none.
**API impact:** six new read-only routes under `/api/exports/*`; no schema,
migration, or report behavior change.
**Existing feature impact:** none (exports are additive and read-only).
**Testing impact:** `tests/unit/exports.test.ts` (RFC-4180 quoting, BOM,
injection guard, JSON byte-identity, document layout, `format` validation);
`tests/http/exports-http.test.ts` (headers/filename, BOM bytes, CASHIER 403 on
the four OWNER-only exports, 401, 400 on bad format, range echo, void
exclusion, JSON ≡ report endpoint, >50-row completeness beyond the pagination
cap, and GET reads never rate-limited).