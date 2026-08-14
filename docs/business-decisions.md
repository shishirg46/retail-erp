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