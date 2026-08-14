// D1 pricing unit suite — min-cost bundle tier pricing (Vitest).
//
// The authoritative value for any sale is `Sale.total` (driven by
// `calculatePrice`); `pricePerUnit` is the informational effective unit price
// (D1). This suite pins the min-cost DP against brute force and the D1
// bundle-boundary semantics. Pure logic, no DB. Cases identical to the
// pre-Vitest suite, expressed in whole paisa (D11).

import { describe, expect, it } from "vitest";
import { calculatePrice } from "../../modules/products/product.service";

import type { PriceTier } from "../../modules/products/product.types";

describe("calculatePrice (D1)", () => {
  it("no tiers: unit price times quantity (paisa)", () => {
    expect(calculatePrice(5, 1000, [])).toBe(5000);
    expect(calculatePrice(1, 1250, [])).toBe(1250);
    expect(calculatePrice(100, 300, [])).toBe(30000);
  });

  it("qty <= 0 returns 0", () => {
    expect(calculatePrice(0, 1000, [])).toBe(0);
    expect(calculatePrice(-4, 1000, [])).toBe(0);
    expect(calculatePrice(0, 1000, [{ minQty: 3, price: 2500 }])).toBe(0);
  });

  it("single tier applies at and above its threshold (D1)", () => {
    const tiers: PriceTier[] = [{ minQty: 3, price: 2500 }];
    const base = 1000;
    expect(calculatePrice(1, base, tiers)).toBe(1000);
    expect(calculatePrice(2, base, tiers)).toBe(2000);
    expect(calculatePrice(3, base, tiers)).toBe(2500);
    expect(calculatePrice(4, base, tiers)).toBe(3500);
    expect(calculatePrice(6, base, tiers)).toBe(5000);
    expect(calculatePrice(7, base, tiers)).toBe(6000);
  });

  it("multiple tiers pick the min-cost combination, not just the largest tier (D1)", () => {
    const tiers: PriceTier[] = [
      { minQty: 3, price: 2500 },
      { minQty: 5, price: 4000 },
    ];
    const base = 1000;
    expect(calculatePrice(3, base, tiers)).toBe(2500);
    expect(calculatePrice(5, base, tiers)).toBe(4000);
    expect(calculatePrice(6, base, tiers)).toBe(5000);
    expect(calculatePrice(7, base, tiers)).toBe(6000);
    expect(calculatePrice(9, base, tiers)).toBe(7500);
  });

  it("DP result is finite and correct when a tier is cheaper than any single unit (D1)", () => {
    const tiers: PriceTier[] = [
      { minQty: 1, price: 900 },
      { minQty: 7, price: 5500 },
    ];
    expect(calculatePrice(7, 1000, tiers)).toBe(5500);
    expect(calculatePrice(8, 1000, tiers)).toBe(6400);
  });

  it("calculatePrice matches brute-force enumeration for small bundles", () => {
    function brute(qty: number, base: number, tiers: PriceTier[]): number {
      if (qty <= 0) return 0;
      let best = qty * base;
      for (const tier of tiers) {
        if (qty >= tier.minQty) {
          best = Math.min(best, tier.price + brute(qty - tier.minQty, base, tiers));
        }
      }
      return best;
    }

    const tiers: PriceTier[] = [
      { minQty: 3, price: 2500 },
      { minQty: 5, price: 4000 },
      { minQty: 10, price: 7000 },
    ];

    for (let qty = 1; qty <= 14; qty++) {
      expect(calculatePrice(qty, 1000, tiers)).toBe(brute(qty, 1000, tiers));
    }
  });
});