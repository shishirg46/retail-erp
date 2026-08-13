// D1 pricing unit suite — min-cost bundle tier pricing.
//
// The authoritative value for any sale is `Sale.total` (driven by
// `calculatePrice`); `pricePerUnit` is the informational effective unit price
// (D1). This suite pins the min-cost DP against brute force and the D1
// bundle-boundary semantics. Pure logic, no DB (tsx + node:assert).

import { strict as assert } from "node:assert";
import { calculatePrice } from "../../modules/products/product.service";
import { createUnit } from "../helpers/runner";

import type { PriceTier } from "../../modules/products/product.types";

const { test, finish } = createUnit();

test("no tiers: unit price times quantity", () => {
  assert.equal(calculatePrice(5, 10, []), 50);
  assert.equal(calculatePrice(1, 12.5, []), 12.5);
  assert.equal(calculatePrice(100, 3, []), 300);
});

test("qty <= 0 returns 0", () => {
  assert.equal(calculatePrice(0, 10, []), 0);
  assert.equal(calculatePrice(-4, 10, []), 0);
  assert.equal(calculatePrice(0, 10, [{ minQty: 3, price: 25 }]), 0);
});

test("single tier applies at and above its threshold (D1)", () => {
  const tiers: PriceTier[] = [{ minQty: 3, price: 25 }];
  const base = 10;
  assert.equal(calculatePrice(1, base, tiers), 10);
  assert.equal(calculatePrice(2, base, tiers), 20);
  assert.equal(calculatePrice(3, base, tiers), 25, "bundle beats 3 singles");
  assert.equal(calculatePrice(4, base, tiers), 35, "bundle + one single");
  assert.equal(calculatePrice(6, base, tiers), 50, "two bundles");
  assert.equal(calculatePrice(7, base, tiers), 60, "two bundles + one single");
});

test("multiple tiers pick the min-cost combination, not just the largest tier (D1)", () => {
  const tiers: PriceTier[] = [
    { minQty: 3, price: 25 },
    { minQty: 5, price: 40 },
  ];
  const base = 10;
  assert.equal(calculatePrice(3, base, tiers), 25);
  assert.equal(calculatePrice(5, base, tiers), 40, "5-tier beats 3+2 (45)");
  assert.equal(calculatePrice(6, base, tiers), 50, "3+3 (50) ties 5+1 (50)");
  assert.equal(calculatePrice(7, base, tiers), 60, "5+1+1 (60) ties 3+3+1 (60)");
  assert.equal(calculatePrice(9, base, tiers), 75, "5+3+1 = 75, 3+3+3 = 75, plain 90");
});

test("DP result is finite and correct when a tier is cheaper than any single unit (D1)", () => {
  const tiers: PriceTier[] = [
    { minQty: 1, price: 9 },
    { minQty: 7, price: 55 },
  ];
  assert.equal(calculatePrice(7, 10, tiers), 55, "7-bundle beats 7 singles (63)");
  assert.equal(calculatePrice(8, 10, tiers), 64, "bundle + one 9 => 64");
});

test("calculatePrice matches brute-force enumeration for small bundles", () => {
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
    assert.equal(calculatePrice(qty, 10, tiers), brute(qty, 10, tiers), `qty ${qty}`);
  }
});

const exitCode = finish();
process.exit(exitCode);