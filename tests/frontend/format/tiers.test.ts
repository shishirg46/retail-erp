import { describe, expect, it } from "vitest";

import { activeTier, cheapestTier, tierHint } from "@/lib/format/tiers";

const TIERS = [
  { minQty: 3, price: 20 },
  { minQty: 10, price: 18 },
];

describe("tier helpers", () => {
  it("returns null from an empty tier list", () => {
    expect(cheapestTier([])).toBeNull();
    expect(activeTier([], 5)).toBeNull();
  });

  it("cheapestTier picks the lowest threshold", () => {
    expect(cheapestTier(TIERS)).toEqual({ minQty: 3, price: 20 });
  });

  it("activeTier returns null below every threshold", () => {
    expect(activeTier(TIERS, 2)).toBeNull();
  });

  it("activeTier returns the highest threshold the quantity meets", () => {
    expect(activeTier(TIERS, 3)).toEqual({ minQty: 3, price: 20 });
    expect(activeTier(TIERS, 9)).toEqual({ minQty: 3, price: 20 });
    expect(activeTier(TIERS, 10)).toEqual({ minQty: 10, price: 18 });
  });

  it("tierHint renders the rupee threshold", () => {
    expect(tierHint({ minQty: 3, price: 20 })).toBe("3+ for रू 20.00");
  });
});
