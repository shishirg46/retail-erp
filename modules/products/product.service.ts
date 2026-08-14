import type { PriceTier } from "./product.types";

// All money is whole paisa (D11), so the DP below accumulates exact integers
// and can never pick up float drift.
export function calculatePrice(
  qty: number,
  basePrice: number,
  tiers: PriceTier[]
): number {
  if (qty <= 0) return 0;

  // No bundle pricing
  if (tiers.length === 0) {
    return qty * basePrice;
  }

  // dp[i] = cheapest price to buy exactly i items
  const dp = new Array(qty + 1).fill(Infinity);

  // Base case
  dp[0] = 0;

  // Calculate cheapest price for every quantity
  for (let i = 1; i <= qty; i++) {
    // Option 1: Buy one more item at normal price
    dp[i] = dp[i - 1] + basePrice;

    // Option 2: Try every bundle
    for (const tier of tiers) {
      if (i >= tier.minQty) {
        dp[i] = Math.min(
          dp[i],
          dp[i - tier.minQty] + tier.price
        );
      }
    }
  }

  return dp[qty];
}