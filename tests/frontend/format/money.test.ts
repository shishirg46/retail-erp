import { describe, expect, it } from "vitest";

import {
  formatRupees,
  formatRupeesCompact,
  formatRupeesFromPaisa,
  formatSignedRupees,
} from "@/lib/format/money";

describe("formatRupees", () => {
  it("formats whole rupees with two decimals (plan §6: 'रू 12,340.50')", () => {
    expect(formatRupees(12340.5)).toBe("रू 12,340.50");
  });

  it("adds South Asian lakh/crore grouping above the lakh", () => {
    expect(formatRupees(123456.5)).toBe("रू 1,23,456.50");
  });

  it("keeps the rupee sign for zero", () => {
    expect(formatRupees(0)).toBe("रू 0.00");
  });

  it("renders negatives with a leading minus after the rupee sign", () => {
    expect(formatRupees(-120)).toBe("रू -120.00");
  });
});

describe("formatRupeesFromPaisa", () => {
  it("divides whole paisa by 100 (D11 output boundary)", () => {
    expect(formatRupeesFromPaisa(1999)).toBe("रू 19.99");
  });
});

describe("formatSignedRupees", () => {
  it("prefixes negatives with 'रू -' for the prepaid balance convention (D4)", () => {
    expect(formatSignedRupees(-120)).toBe("रू -120.00");
  });

  it("matches plain formatting for non-negative values", () => {
    expect(formatSignedRupees(120)).toBe("रू 120.00");
  });
});

describe("formatRupeesCompact", () => {
  it("falls back to the full format under one thousand", () => {
    expect(formatRupeesCompact(999)).toBe("रू 999.00");
  });

  it("uses k for thousands", () => {
    expect(formatRupeesCompact(12345)).toBe("रू 12.3k");
  });

  it("uses L for lakhs", () => {
    expect(formatRupeesCompact(150000)).toBe("रू 1.5L");
  });

  it("uses Cr for crores", () => {
    expect(formatRupeesCompact(21000000)).toBe("रू 2.1Cr");
  });
});
