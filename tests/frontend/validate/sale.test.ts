import { describe, expect, it } from "vitest";

import { MAX_ITEM_QUANTITY } from "@/lib/bounds";
import { newSaleSchema } from "@/lib/validate/sale";

describe("newSaleSchema", () => {
  it("accepts a valid CASH sale", () => {
    const result = newSaleSchema.safeParse({
      paymentType: "CASH",
      items: [{ productId: "p-1", quantity: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid CREDIT sale with a customer", () => {
    const result = newSaleSchema.safeParse({
      paymentType: "CREDIT",
      customerId: "c-1",
      items: [{ productId: "p-1", quantity: 1 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty items array", () => {
    const result = newSaleSchema.safeParse({ paymentType: "CASH", items: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("items"))).toBe(true);
    }
  });

  it("rejects a zero quantity", () => {
    const zero = newSaleSchema.safeParse({
      paymentType: "CASH",
      items: [{ productId: "p-1", quantity: 0 }],
    });
    expect(zero.success).toBe(false);
  });

  it("accepts fractional quantities and rejects more than 2 dp (D25.2)", () => {
    const fractional = newSaleSchema.safeParse({
      paymentType: "CASH",
      items: [{ productId: "p-1", quantity: 2.5 }],
    });
    const tooPrecise = newSaleSchema.safeParse({
      paymentType: "CASH",
      items: [{ productId: "p-1", quantity: 2.505 }],
    });
    expect(fractional.success).toBe(true);
    expect(tooPrecise.success).toBe(false);
  });

  it("rejects a quantity over the backend cap", () => {
    const result = newSaleSchema.safeParse({
      paymentType: "CASH",
      items: [{ productId: "p-1", quantity: MAX_ITEM_QUANTITY + 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown payment type", () => {
    const result = newSaleSchema.safeParse({
      paymentType: "BANK",
      items: [{ productId: "p-1", quantity: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("requires a customerId for CREDIT", () => {
    const result = newSaleSchema.safeParse({
      paymentType: "CREDIT",
      items: [{ productId: "p-1", quantity: 1 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("customerId"))).toBe(true);
    }
  });
});
