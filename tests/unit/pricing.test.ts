// D1 pricing unit suite — min-cost bundle tier pricing (Vitest).
//
// The authoritative value for any sale is `Sale.total` (driven by
// `calculatePrice`); `pricePerUnit` is the informational effective unit price
// (D1). This suite pins the min-cost DP against brute force and the D1
// bundle-boundary semantics. Pure logic, no DB. Quantities are integer
// hundredths (scaled units, D25.6) and money is whole paisa (D11).

import { describe, expect, it } from "vitest";
import { calculatePrice } from "../../modules/products/product.service";

import type { PriceTier } from "../../modules/products/product.types";

// Human units -> scaled units (the quantity analogue of rupees -> paisa).
const u = (n: number): number => n * 100;

describe("calculatePrice (D1)", () => {
  it("no tiers: unit price times quantity (paisa)", () => {
    expect(calculatePrice(u(5), 1000, [])).toBe(5000);
    expect(calculatePrice(u(1), 1250, [])).toBe(1250);
    expect(calculatePrice(u(100), 300, [])).toBe(30000);
  });

  it("no tiers: fractional quantities price exactly (D25.3)", () => {
    // 0.5 kg @ ₹10/kg = 500 paisa; 2.25 kg @ ₹20/kg = 4500 paisa.
    expect(calculatePrice(u(0.5), 1000, [])).toBe(500);
    expect(calculatePrice(u(2.25), 2000, [])).toBe(4500);
    expect(calculatePrice(u(0.25), 1000, [])).toBe(250);
  });

  it("qty <= 0 returns 0", () => {
    expect(calculatePrice(0, 1000, [])).toBe(0);
    expect(calculatePrice(-4, 1000, [])).toBe(0);
    expect(calculatePrice(0, 1000, [{ minQty: u(3), price: 2500 }])).toBe(0);
  });

  it("single tier applies at and above its threshold (D1)", () => {
    const tiers: PriceTier[] = [{ minQty: u(3), price: 2500 }];
    const base = 1000;
    expect(calculatePrice(u(1), base, tiers)).toBe(1000);
    expect(calculatePrice(u(2), base, tiers)).toBe(2000);
    expect(calculatePrice(u(3), base, tiers)).toBe(2500);
    expect(calculatePrice(u(4), base, tiers)).toBe(3500);
    expect(calculatePrice(u(6), base, tiers)).toBe(5000);
    expect(calculatePrice(u(7), base, tiers)).toBe(6000);
  });

  it("largest applicable tier is consumed first, then the remainder (D25.3)", () => {
    const tiers: PriceTier[] = [
      { minQty: u(3), price: 2500 },
      { minQty: u(5), price: 4000 },
    ];
    const base = 1000;
    expect(calculatePrice(u(3), base, tiers)).toBe(2500);
    expect(calculatePrice(u(5), base, tiers)).toBe(4000);
    expect(calculatePrice(u(6), base, tiers)).toBe(5000);
    expect(calculatePrice(u(7), base, tiers)).toBe(6000);
    expect(calculatePrice(u(9), base, tiers)).toBe(7500);
  });

  it("fractional tier pricing keeps the largest tier + remainder path (D25.3)", () => {
    const tiers: PriceTier[] = [
      { minQty: u(5), price: 45000 },
      { minQty: u(3), price: 25000 },
    ];
    expect(calculatePrice(u(5.5), 10000, tiers)).toBe(50000);
    expect(calculatePrice(u(7), 10000, tiers)).toBe(65000);
    expect(calculatePrice(u(2.75), 10000, [{ minQty: u(2.5), price: 26000 }])).toBe(28500);
  });

  it("DP result is finite and correct when a tier is cheaper than any single unit (D1)", () => {
    const tiers: PriceTier[] = [
      { minQty: u(1), price: 900 },
      { minQty: u(7), price: 5500 },
    ];
    expect(calculatePrice(u(7), 1000, tiers)).toBe(5500);
    expect(calculatePrice(u(8), 1000, tiers)).toBe(6400);
  });

  it("fractional quantities price against a tier plus the remainder (D25.3)", () => {
    // 5 kg tier @ ₹450, base ₹100/kg: 5.5 kg = tier + 0.5 kg at base = ₹500.
    const tiers: PriceTier[] = [{ minQty: u(5), price: 45000 }];
    expect(calculatePrice(u(5.5), 10000, tiers)).toBe(50000);
    expect(calculatePrice(u(5), 10000, tiers)).toBe(45000);
    // Below the threshold: base price applies (5.5 - 5 = 0.5 remainder only
    // kicks in once the bundle is complete).
    expect(calculatePrice(u(2.5), 10000, tiers)).toBe(25000);
  });

  it("fractional tier thresholds (D25.4)", () => {
    // 2.5 kg tier @ ₹260, base ₹100/kg: buying 2.5 kg takes the tier.
    const tiers: PriceTier[] = [{ minQty: u(2.5), price: 26000 }];
    expect(calculatePrice(u(2.5), 10000, tiers)).toBe(26000);
    expect(calculatePrice(u(2.75), 10000, tiers)).toBe(28500);
    expect(calculatePrice(u(2.25), 10000, tiers)).toBe(22500);
  });

  it("calculatePrice matches brute-force enumeration for small bundles", () => {
    // Brute force over the scaled grid, in hundredths-of-paisa (the same unit
    // the DP minimizes in), rounded to whole paisa at the end — exactly like
    // calculatePrice (D25.7).
    function brute(qty: number, base: number, tiers: PriceTier[]): number {
      if (qty <= 0) return 0;
      let best = qty * base;
      for (const tier of tiers) {
        if (qty >= tier.minQty) {
          best = Math.min(
            best,
            tier.price * 100 + brute(qty - tier.minQty, base, tiers)
          );
        }
      }
      return best;
    }

    const tiers: PriceTier[] = [
      { minQty: u(3), price: 2500 },
      { minQty: u(5), price: 4000 },
      { minQty: u(10), price: 7000 },
    ];

    for (let qty = 1; qty <= u(14); qty++) {
      expect(calculatePrice(qty, 1000, tiers)).toBe(Math.round(brute(qty, 1000, tiers) / 100));
    }
  });
});
