// Postgres row-level locking helpers (D18.11).
//
// Under READ COMMITTED, two transactions that both READ a Sale and then write
// the VoidRecord / CreditPayment for it can each see the other's pre-write
// state and both "succeed" — leaving a CreditPayment linked to a voided Sale.
// Both the void path and the payment-link path therefore take an exclusive
// SELECT ... FOR UPDATE lock on the same sales row before reading the sale's
// void/linked-payment state, serializing the two operations: whichever locks
// first commits first, and the second re-checks against the committed state.

import { prisma } from "./prisma";

type LockableTx = { $queryRaw: typeof prisma["$queryRaw"] };

export async function lockSaleRow(tx: LockableTx, saleId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${saleId} FOR UPDATE`;
}
