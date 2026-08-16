import type { PriceTier } from "./product.types";

// All money is whole paisa (D11) and quantities are integer hundredths
// (D25.6), so the pricing math below stays exact and never relies on JS float
// arithmetic.
//
// The shop's frozen pricing model is the existing tier-first remainder behavior:
// consume the largest applicable tier first, then apply any remainder at the
// current base price. This preserves the business semantics while still using
// integer-scaled quantities for exact arithmetic.
export function calculatePrice(
  qty: number,
  basePrice: number,
  tiers: PriceTier[]
): number {
  if (qty <= 0) return 0;

  if (tiers.length === 0) {
    return Math.round((qty * basePrice) / 100);
  }

  const sortedTiers = [...tiers].sort((a, b) => b.minQty - a.minQty);
  let remaining = qty;
  let total = 0;

  for (const tier of sortedTiers) {
    if (remaining <= 0) break;

    const wholeTiers = Math.floor(remaining / tier.minQty);
    if (wholeTiers <= 0) continue;

    total += wholeTiers * tier.price;
    remaining -= wholeTiers * tier.minQty;
  }

  if (remaining > 0) {
    total += Math.round((remaining * basePrice) / 100);
  }

  return total;
}
