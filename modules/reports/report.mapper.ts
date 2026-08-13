// Prisma stores money as Decimal; the application works with number.
// Aggregate sums may also be Decimal | null (empty set).
export function toNumber(value: unknown): number {
  const v = value as { toNumber?: () => number } | null | undefined;
  if (v === null || v === undefined) return 0;
  return typeof v.toNumber === "function" ? v.toNumber() : (v as number);
}