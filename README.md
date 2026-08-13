# retail-erp

A production-style Retail ERP for a small shop — sales, purchasing, customer
credit, inventory with an auditable stock ledger, and a read-only reporting
layer. Built on Next.js API routes with a strict **Route → Service →
Repository → Prisma** layering.

## Stack

- Next.js (App Router) API routes
- TypeScript (strict)
- PostgreSQL + Prisma ORM (`PrismaPg` adapter, generated client in
  `generated/prisma`)
- Tailwind CSS (scaffold only)

## Architecture

Every feature follows the same shape under `modules/<feature>/`:

| File | Responsibility |
| ---- | -------------- |
| `*.types.ts` | Domain types + repository interface |
| `*.validation.ts` | Request validation → `ValidationError` (400) |
| `*.mapper.ts` | Prisma model ↔ domain mapping (Decimal → number) |
| `*.repository.ts` | Persistence; takes a transaction client |
| `*.service.ts` | Business rules; one `$transaction` per multi-step operation |

Routes in `app/api/` are thin: validate → service → `toHttpResponse(error)`.

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
cp .env.example .env   # DATABASE_URL -> your PostgreSQL
npm install
npx prisma migrate dev
npm run dev
```

## Verification workflow

- `npx tsc --noEmit` and `npm run lint` must stay green.
- Import the Postman collection (`postman/Retail-ERP.postman_collection.json`)
  and run folders in order — ids chain via environment variables.
- Reconciliation invariants, verified via SQL:
  - `Product.stockQty == Σ StockMovement.qtyChange` (per product, D6)
  - customer `balanceOwed == Σ credit sales − Σ payments` (signed, D4)
  - wallet balance `== Σ DEPOSIT − Σ WITHDRAWAL`

## Documentation

- [`docs/business-decisions.md`](docs/business-decisions.md) — D1–D7 business
  and architecture decisions
- [`docs/implementation-log.md`](docs/implementation-log.md) — milestone log
