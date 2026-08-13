# retail-erp

A production-style Retail ERP for a small shop — sales, purchasing, customer
credit, inventory with an auditable stock ledger, and a read-only reporting
layer. Built on Next.js API routes with a **Route → Service → Repository →
Prisma** layering (simple CRUD features may skip the service layer).

## Stack

- Next.js (App Router) API routes
- TypeScript (strict)
- PostgreSQL + Prisma ORM (`PrismaPg` adapter, generated client in
  `generated/prisma`)
- Tailwind CSS (scaffold only)

## Architecture

Modules under `modules/<feature>/` follow an opinionated but **not uniform**
shape. Files exist where the feature needs them:

| File | Responsibility | Present |
| ---- | -------------- | ------- |
| `*.types.ts` | Domain types + repository interface | all modules |
| `*.validation.ts` | Request validation → `ValidationError` (400) | sales, purchases, suppliers, supplier-payments, customers, customer-payments, stock, reports |
| `*.mapper.ts` | Prisma model ↔ domain mapping (Decimal → number) | sales, purchases, customers, reports |
| `*.repository.ts` | Persistence; takes a transaction client | all modules |
| `*.service.ts` | Business rules; one `$transaction` per multi-step operation | products, sales, purchases, suppliers, supplier-payments, customers, customer-payments, stock, reports |

Notes on the coverage:

- Simple CRUD features (products, suppliers, customers) convert Decimal → number
  inline in their repository/mapper rather than always having a dedicated
  `*.mapper.ts`.
- `modules/wallet/` is a shared repository only (types + repository) — wallet
  side effects are driven by the sales/purchases/payment services.
- The service layer is thin pass-through for pure CRUD features (products,
  suppliers, customers) and holds the business rules for transactional flows
  (sales, purchases, supplier-payments, customer-payments, stock).
- **Products validation:** `POST /api/products` validates the payload through
  `modules/products/product.validation.ts` (required fields, price polarity,
  price-tier shape, duplicate `minQty`, bounded string lengths) before
  persisting; invalid payloads return 400.

Routes in `app/api/` are thin: parse body → validate (where the module has a
validator) → service/repository → `toHttpResponse(error)`.

Money is `Decimal` in Postgres, `number` in the application (converted at
repository boundaries). All business rules are enforced in services, never in
repositories. Historical prices are frozen (`SaleItem.pricePerUnit`,
`PurchaseItem.costPerUnit`); `Product.costPrice` is only the latest reference.

## Modules & Routes

| Module | Routes |
| ------ | ------ |
| Products & tier pricing | `POST/GET /api/products`, `GET /api/products/[id]` |
| Sales (CASH/ECASH/CREDIT) | `POST/GET /api/sales`, `GET /api/sales/[id]` |
| Suppliers | `POST/GET /api/suppliers`, `GET /api/suppliers/[id]` |
| Purchases (CASH/CREDIT) | `POST/GET /api/purchases`, `GET /api/purchases/[id]` |
| Supplier payments | `POST /api/supplier-payments` |
| Customers | `POST/GET /api/customers`, `GET /api/customers/[id]` |
| Customer payments (credit) | `POST /api/customer-payments` |
| Stock adjustments | `POST /api/stock/adjustments`, `GET /api/stock/movements` |
| Reports (read-only) | `GET /api/reports/{sales,purchases,stock,customers,suppliers,wallet}` |

## Setup

```bash
# Create .env with your DATABASE_URL (no .env.example is shipped yet — see note)
printf 'DATABASE_URL=postgresql://USER:PASS@localhost:5432/erp_retail\n' > .env
npm install
npx prisma migrate dev
npm run dev
```

> **Note:** `.env.example` does not currently exist in the repository (tracked as
> a known gap for the upcoming audit). Provide `DATABASE_URL` in `.env` before
> running Prisma.

## Verification workflow

- `npx tsc --noEmit` and `npm run lint` must stay green.
- `npm run test:concurrency` runs the stock-concurrency regression suite against
  the dedicated `erp_retail_test` database (`TEST_DATABASE_URL` in `.env`). It
  refuses to run against any other database.
- Import the Postman collection (`postman/Retail-ERP.postman_collection.json`)
  and run folders in order — ids chain via environment variables.
- Reconciliation invariants, verified via SQL:
  - `Product.stockQty == Σ StockMovement.qtyChange` (per product, D6)
  - customer `balanceOwed == Σ credit sales − Σ payments` (signed, D4)
  - wallet balance `== Σ DEPOSIT − Σ WITHDRAWAL`

## Documentation

- [`docs/business-decisions.md`](docs/business-decisions.md) — D1–D8 business
  and architecture decisions
- [`docs/implementation-log.md`](docs/implementation-log.md) — milestone log
- [`docs/project-progress.md`](docs/project-progress.md) — current status,
  roadmap, and known risks
- [`docs/architecture-audit.md`](docs/architecture-audit.md) — audit findings
  (F-01…F-16) and fix status
