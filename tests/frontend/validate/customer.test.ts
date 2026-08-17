import { describe, expect, it } from "vitest";

import {
  createCustomerSchema,
  createCustomerPaymentSchema,
  voidCustomerPaymentSchema,
} from "@/lib/validate/customer";

describe("createCustomerSchema", () => {
  it("rejects empty name", () => {
    const result = createCustomerSchema.safeParse({ name: "", contact: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    const result = createCustomerSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts valid name with contact", () => {
    const result = createCustomerSchema.safeParse({ name: "Ram", contact: "9801234567" });
    expect(result.success).toBe(true);
  });

  it("accepts valid name without contact", () => {
    const result = createCustomerSchema.safeParse({ name: "Ram" });
    expect(result.success).toBe(true);
  });
});

describe("createCustomerPaymentSchema", () => {
  it("rejects zero amount", () => {
    const result = createCustomerPaymentSchema.safeParse({ amount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = createCustomerPaymentSchema.safeParse({ amount: -100 });
    expect(result.success).toBe(false);
  });

  it("accepts valid positive amount", () => {
    const result = createCustomerPaymentSchema.safeParse({ amount: 500 });
    expect(result.success).toBe(true);
  });

  it("accepts valid amount with optional saleId", () => {
    const result = createCustomerPaymentSchema.safeParse({ amount: 500, saleId: "sale-1" });
    expect(result.success).toBe(true);
  });
});

describe("voidCustomerPaymentSchema", () => {
  it("rejects empty reason", () => {
    const result = voidCustomerPaymentSchema.safeParse({ reason: "" });
    expect(result.success).toBe(false);
  });

  it("accepts valid reason", () => {
    const result = voidCustomerPaymentSchema.safeParse({ reason: "Customer requested" });
    expect(result.success).toBe(true);
  });

  it("accepts valid reason with optional note", () => {
    const result = voidCustomerPaymentSchema.safeParse({ reason: "Mistake", note: "Extra info" });
    expect(result.success).toBe(true);
  });
});
