// Generic Decimal -> number for NON-money aggregates (e.g. summed qtyChange).
// Money columns must use paisaFromDecimal from lib/money so the report math
// stays exact; rupees are emitted once at payload construction (D11).
export function toNumber(value: unknown): number {
  const v = value as { toNumber?: () => number } | null | undefined;
  if (v === null || v === undefined) return 0;
  return typeof v.toNumber === "function" ? v.toNumber() : (v as number);
}