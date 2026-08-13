// D1 pricing unit suite — min-cost bundle tier pricing (Vitest).
//
// The authoritative value for any sale is `Sale.total` (driven by
// `calculatePrice`); `pricePerUnit` is the informational effective unit price
// (D1). This suite pins the min-cost DP against brute force and the D1
// bundle-boundary semantics. Pure logic, no DB. Cases identical to the
// pre-Vitest suite.

import { describe, expect, it } from "vitest";
import { calculatePrice } from "../../modules/products/product.service";

import type { PriceTier } from "../../modules/products/product.types";

describe("calculatePrice (D1)", () => {
  it("no tiers: unit price times quantity", () => {
    expect(calculatePrice(5, 10, [])).toBe(50);
    expect(calculatePrice(1, 12.5, [])).toBe(12.5);
    expect(calculatePrice(100, 3, [])).toBe(300);
  });

  it("qty <= 0 returns 0", () => {
    expect(calculatePrice(0, 10, [])).toBe(0);
    expect(calculatePrice(-4, 10, [])).toBe(0);
    expect(calculatePrice(0, 10, [{ minQty: 3, price: 25 }])).toBe(0);
  });

  it("single tier applies at and above its threshold (D1)", () => {
    const tiers: PriceTier[] = [{ minQty: 3, price: 25 }];
    const base = 10;
    expect(calculatePrice(1, base, tiers)).toBe(10);
    expect(calculatePrice(2, base, tiers)).toBe(20);
    expect(calculatePrice(3, base, tiers)).toBe(25);
    expect(calculatePrice(4, base, tiers)).toBe(35);
    expect(calculatePrice(6, base, tiers)).toBe(50);
    expect(calculatePrice(7, base, tiers)).toBe(60);
  });

  it("multiple tiers pick the min-cost combination, not just the largest tier (D1)", () => {
    const tiers: PriceTier[] = [
      { minQty: 3, price: 25 },
      { minQty: 5, price: 40 },
    ];
    const base = 10;
    expect(calculatePrice(3, base, tiers)).toBe(25);
    expect(calculatePrice(5, base, tiers)).toBe(40);
    expect(calculatePrice(6, base, tiers)).toBe(50);
    expect(calculatePrice(7, base, tiers)).toBe(60);
    expect(calculatePrice(9, base, tiers)).toBe(75);
  });

  it("DP result is finite and correct when a tier is cheaper than any single unit (D1)", () => {
    const tiers: PriceTier[] = [
      { minQty: 1, price: 9 },
      { minQty: 7, price: 55 },
    ];
    expect(calculatePrice(7, 10, tiers)).toBe(55);
    expect(calculatePrice(8, 10, tiers)).toBe(64);
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
      { minQty: 3, price: 25 },
      { minQty: 5, price: 40 },
      { minQty: 10, price: 70 },
    ];

    for (let qty = 1; qty <= 14; qty++) {
      expect(calculatePrice(qty, 10, tiers)).toBe(brute(qty, 10, tiers));
    }
  });
});