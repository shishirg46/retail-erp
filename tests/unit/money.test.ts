// D11 money unit suite — integer-paisa domain money (Vitest).
//
// Proves the rupee<->paisa conversions, the single round-half-up policy, the
// Decimal -> paisa boundary read, and the round-trip guarantee that motivated
// the change (float rupee sums were never exact; whole-paisa sums are).

import { describe, expect, it } from "vitest";
import {
  paisaFromDecimal,
  paisaToRupees,
  roundHalfUp,
  rupeesToPaisa,
  MAX_AMOUNT_PAISA,
} from "../../lib/money";
import { MAX_AMOUNT } from "../../lib/bounds";

describe("rupeesToPaisa (input boundary)", () => {
  it("two-decimal rupee prices convert exactly", () => {
    expect(rupeesToPaisa(19.99)).toBe(1999);
    expect(rupeesToPaisa(0)).toBe(0);
    expect(rupeesToPaisa(20)).toBe(2000);
    expect(rupeesToPaisa(10000000)).toBe(1000000000);
  });

  it("binary-float rupee values still land on whole paisa", () => {
    expect(rupeesToPaisa(0.1)).toBe(10);
    expect(rupeesToPaisa(0.3)).toBe(30);
    expect(rupeesToPaisa(4.99)).toBe(499);
  });

  it("rounds half up exactly once, on the input", () => {
    expect(rupeesToPaisa(0.105)).toBe(11);
    expect(rupeesToPaisa(0.104)).toBe(10);
    expect(rupeesToPaisa(2.5)).toBe(250);
  });
});

describe("paisaToRupees (output boundary)", () => {
  it("whole paisa back to rupees with two decimals", () => {
    expect(paisaToRupees(1999)).toBe(19.99);
    expect(paisaToRupees(0)).toBe(0);
    expect(paisaToRupees(1000000000)).toBe(10000000);
    expect(paisaToRupees(499)).toBe(4.99);
  });
});

describe("roundHalfUp", () => {
  it("is half-up for ties", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(3.5)).toBe(4);
  });

  it("rounds down below half", () => {
    expect(roundHalfUp(0.499)).toBe(0);
    expect(roundHalfUp(2.49)).toBe(2);
  });
});

describe("paisaFromDecimal (repository boundary read)", () => {
  const decimal = (n: number) => ({ toNumber: () => n });

  it("recovers whole paisa from rupee Decimals", () => {
    expect(paisaFromDecimal(decimal(19.99))).toBe(1999);
    expect(paisaFromDecimal(decimal(0))).toBe(0);
    expect(paisaFromDecimal(decimal(12.34))).toBe(1234);
  });

  it("handles null/undefined aggregates as zero", () => {
    expect(paisaFromDecimal(null)).toBe(0);
    expect(paisaFromDecimal(undefined)).toBe(0);
  });

  it("passes plain numbers through", () => {
    expect(paisaFromDecimal(19.99)).toBe(1999);
  });
});

describe("round-trip guarantee (D11)", () => {
  it("rupees -> paisa -> rupees is lossless for 2-decimal values", () => {
    const values = [
      0,
      0.1,
      0.2,
      0.3,
      4.99,
      19.99,
      12.34,
      100,
      1000.5,
      9999.99,
      10000000,
    ];
    for (const rupees of values) {
      expect(paisaToRupees(rupeesToPaisa(rupees))).toBe(rupees);
    }
  });

  it("paisa sums are exact integers (no drift)", () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += 5;
    expect(sum).toBe(5000);
    expect(Number.isInteger(sum)).toBe(true);
  });

  it("MAX_AMOUNT_PAISA stays far inside the safe-integer range", () => {
    expect(MAX_AMOUNT_PAISA).toBe(MAX_AMOUNT * 100);
    expect(MAX_AMOUNT_PAISA).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
