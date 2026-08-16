// Integer-scaled (hundredths) domain quantities (D25).
//
// Postgres keeps quantity DECIMAL(18,2)s; the JS domain operates exclusively on
// integer hundredths (1.25 kg = 125 units) — the quantity analogue of the
// whole-paisa money model in lib/money.ts (D11). Human quantities convert to
// scaled units exactly once at the input boundary and back exactly once at the
// output boundary, so every domain calculation (pricing, stock, totals) is
// integer-exact and can never pick up float drift.
//
// JS number is IEEE-754 binary64: exact integers up to 2^53-1 ≈ 9.007e15.
// MAX_ITEM_QUANTITY (1000 human units) = 100000 scaled units per line, and
// line totals stay far inside the safe range, so any realistic accumulation is
// exact.

import { MAX_ITEM_QUANTITY } from "./bounds";
import { roundHalfUp } from "./money";

// Internal scaled-unit bound: the largest quantity a single line / tier /
// adjustment can carry after scaling (D25.2, bounds.ts). This is what bounds
// the calculatePrice DP array.
export const MAX_QUANTITY_UNITS = MAX_ITEM_QUANTITY * 100;

// The frozen unit set (D25.1) — controlled rather than arbitrary free-text.
export const SUPPORTED_UNITS = ["pcs", "kg", "g", "liter", "ml"] as const;
export type Unit = (typeof SUPPORTED_UNITS)[number];

export function isSupportedUnit(unit: string): boolean {
  return (SUPPORTED_UNITS as readonly string[]).includes(unit);
}

// Measurable units (kg, g, liter, ml) accept fractional quantities; `pcs` is
// whole units only (D25.1).
export function unitAllowsFractional(unit: string): boolean {
  return unit !== "pcs";
}

// Human quantity (number, from the API boundary) -> integer hundredths.
// Human quantities are assumed to have at most 2 decimals; the round half-up
// here is the single sanctioned input rounding (D25.2). e.g. 2.5 -> 250,
// 0.25 -> 25 (0.25*100 = 25.000000000000004).
export function quantityToUnits(quantity: number): number {
  return roundHalfUp(quantity * 100);
}

// Integer hundredths -> human quantity (number, API/report output boundary).
// Exactly one output conversion, after all scaled math is done: 250 -> 2.5.
export function unitsToQuantity(units: number): number {
  return units / 100;
}

// Decimal (or number) read from the database -> integer hundredths. The DB
// stores human quantities (units / 100), so ×100 and round recovers the exact
// integer units (DECIMAL(18,2) means the value never has more than 2 dp).
export function quantityFromDecimal(value: unknown): number {
  const v = value as { toNumber?: () => number } | null | undefined;
  if (v === null || v === undefined) return 0;
  const quantity = typeof v.toNumber === "function" ? v.toNumber() : (v as number);
  return roundHalfUp(quantity * 100);
}

// Does `value` carry at most 2 decimal places? 0.25 / 2.5 / 1000 pass;
// 1.257 is rejected (D25.2). The round-half-up comparison absorbs binary
// float noise (e.g. 0.25*100 = 25.000000000000004).
export function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && roundHalfUp(value * 100) / 100 === value;
}
