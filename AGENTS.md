<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project conventions

- Architecture: Route → Service → Repository → Prisma. Routes are thin; services
  own business rules (one `$transaction` per multi-step operation); repositories
  own persistence and convert Decimal → number at the boundary.
- Money: `Decimal` in Postgres, `number` in the application code.
- Reports are read-only derivations over transactional tables (D7) — never store
  report totals, never invent COGS/valuation/profit.
- After every completed milestone, append to `docs/implementation-log.md`
  (date, what shipped, verification evidence) and keep this file accurate as
  the map of the codebase.
- Business decisions go in `docs/business-decisions.md` (D-series, change
  management format from the master spec).
- Always verify: `npx tsc --noEmit` and `npm run lint` must be green.
- Reconciliation invariants — keep them true when touching sales, purchases,
  payments, or stock:
  - `Product.stockQty == Σ StockMovement.qtyChange` per product (D6)
  - wallet balance `== Σ DEPOSIT − Σ WITHDRAWAL`
