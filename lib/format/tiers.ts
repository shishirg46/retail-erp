// Price-tier hints (D1, plan §12.1). The UI never prices a sale — it only
// surfaces the tier thresholds that exist in the product payload; the server
// recomputes the authoritative total on save (D22.2). Values at the wire are
// rupees.

import type { PriceTier } from "@/modules/products/product.types";

import { formatRupees } from "./money";

// The lowest threshold tier — the product-card hint ("3+ for रू 20").
export function cheapestTier(tiers: readonly PriceTier[]): PriceTier | null {
  let cheapest: PriceTier | null = null;
  for (const tier of tiers) {
    if (cheapest === null || tier.minQty < cheapest.minQty) cheapest = tier;
  }
  return cheapest;
}

// The highest threshold the current cart quantity already meets — the
// cart-line hint. Returns null when the quantity crosses no tier.
export function activeTier(
  tiers: readonly PriceTier[],
  qty: number
): PriceTier | null {
  let hit: PriceTier | null = null;
  for (const tier of tiers) {
    if (tier.minQty <= qty && (hit === null || tier.minQty > hit.minQty)) hit = tier;
  }
  return hit;
}

export function tierHint(tier: { minQty: number; price: number }): string {
  return `${tier.minQty}+ for ${formatRupees(tier.price)}`;
}
