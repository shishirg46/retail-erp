// Integer-paisa domain money (D11).
//
// Postgres keeps rupee DECIMALs; the JS domain operates exclusively on whole
// paisa (integer) so that every sum is exact. Rupees convert to paisa exactly
// once at the input boundary and back exactly once at the output boundary —
// the "round half up" step below is the ONLY rounding in the money path.
//
// JS number is IEEE-754 binary64: exact integers up to 2^53-1 ≈ 9.007e15.
// MAX_AMOUNT (1e7 rupees) = 1e9 paisa, and every document is ≤ 100 lines of
// ≤ 100000 units, so any realistic accumulation stays far inside the safe range.

import { MAX_AMOUNT } from "./bounds";

// Max value for a single monetary input in paisa (rupees * 100).
export const MAX_AMOUNT_PAISA = MAX_AMOUNT * 100;

// Round half up to the nearest integer. For the non-negative amounts the
// system handles this matches Math.round; kept as a named helper so the single
// rounding policy of the codebase has one obvious home (D11).
export function roundHalfUp(value: number): number {
  return Math.round(value);
}

// Rupees (number, from the API boundary) -> whole paisa. Rupees are assumed to
// have at most 2 decimals; the round half-up here is the single sanctioned
// input rounding. e.g. 19.99 -> 1999, 0.1 -> 10 (0.1*100 = 10.000000000000002).
export function rupeesToPaisa(rupees: number): number {
  return roundHalfUp(rupees * 100);
}

// Whole paisa -> rupees (number, API/report output boundary). Exactly one
// output conversion, after all paisa math is done: 1999 -> 19.99.
export function paisaToRupees(paisa: number): number {
  return paisa / 100;
}

// Decimal (or number) read from the database -> whole paisa. The DB stores
// rupees (paisa / 100), so ×100 and round recovers the exact integer paisa.
export function paisaFromDecimal(value: unknown): number {
  const v = value as { toNumber?: () => number } | null | undefined;
  if (v === null || v === undefined) return 0;
  const rupees = typeof v.toNumber === "function" ? v.toNumber() : (v as number);
  return roundHalfUp(rupees * 100);
}
