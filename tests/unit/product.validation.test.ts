// F-01 unit tests for validateCreateProductInput (Vitest migration).
//
// Pure validator tests — no database access, so the development database is
// untouchable by construction.

import { describe, expect, it } from "vitest";
import { ValidationError } from "../../lib/errors";
import { validateCreateProductInput } from "../../modules/products/product.validation";

describe("F-01 validateCreateProductInput", () => {
  it("valid full product", () => {
    const input = validateCreateProductInput({
      name: "Biscuit",
      unit: "pack",
      category: "snacks",
      costPrice: 18,
      currentPrice: 20,
      priceTiers: [
        { minQty: 3, price: 50 },
        { minQty: 10, price: 150 },
      ],
    });
    expect(input).toBeDefined();
  });

  it("valid product, no category/tiers", () => {
    const input = validateCreateProductInput({ name: "Rice", unit: "kg", costPrice: 100, currentPrice: 120 });
    expect(input).toBeDefined();
  });

  it("non-object body", () => {
    expect(() => validateCreateProductInput("hello")).toThrow(ValidationError);
  });

  it("null body", () => {
    expect(() => validateCreateProductInput(null)).toThrow(ValidationError);
  });

  it("missing name", () => {
    expect(() =>
      validateCreateProductInput({ unit: "kg", costPrice: 1, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("empty name", () => {
    expect(() =>
      validateCreateProductInput({ name: "", unit: "kg", costPrice: 1, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("whitespace name", () => {
    expect(() =>
      validateCreateProductInput({ name: "   ", unit: "kg", costPrice: 1, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("non-string name", () => {
    expect(() =>
      validateCreateProductInput({ name: 42, unit: "kg", costPrice: 1, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("over-long name", () => {
    expect(() =>
      validateCreateProductInput({
        name: "x".repeat(201),
        unit: "kg",
        costPrice: 1,
        currentPrice: 2,
      })
    ).toThrow(ValidationError);
  });

  it("missing unit", () => {
    expect(() =>
      validateCreateProductInput({ name: "Rice", costPrice: 1, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("empty unit", () => {
    expect(() =>
      validateCreateProductInput({ name: "Rice", unit: "", costPrice: 1, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("over-long unit", () => {
    expect(() =>
      validateCreateProductInput({
        name: "Rice",
        unit: "x".repeat(51),
        costPrice: 1,
        currentPrice: 2,
      })
    ).toThrow(ValidationError);
  });

  it("negative costPrice", () => {
    expect(() =>
      validateCreateProductInput({ name: "A", unit: "kg", costPrice: -1, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("NaN costPrice", () => {
    expect(() =>
      validateCreateProductInput({ name: "A", unit: "kg", costPrice: NaN, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("Infinity costPrice", () => {
    expect(() =>
      validateCreateProductInput({ name: "A", unit: "kg", costPrice: Infinity, currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("non-number costPrice", () => {
    expect(() =>
      validateCreateProductInput({ name: "A", unit: "kg", costPrice: "5", currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("missing costPrice", () => {
    expect(() =>
      validateCreateProductInput({ name: "A", unit: "kg", currentPrice: 2 })
    ).toThrow(ValidationError);
  });

  it("zero currentPrice", () => {
    expect(() =>
      validateCreateProductInput({ name: "A", unit: "kg", costPrice: 1, currentPrice: 0 })
    ).toThrow(ValidationError);
  });

  it("negative currentPrice", () => {
    expect(() =>
      validateCreateProductInput({ name: "A", unit: "kg", costPrice: 1, currentPrice: -5 })
    ).toThrow(ValidationError);
  });

  it("NaN currentPrice", () => {
    expect(() =>
      validateCreateProductInput({ name: "A", unit: "kg", costPrice: 1, currentPrice: NaN })
    ).toThrow(ValidationError);
  });

  it("non-array priceTiers", () => {
    expect(() =>
      validateCreateProductInput({
        name: "A",
        unit: "kg",
        costPrice: 1,
        currentPrice: 2,
        priceTiers: "hello",
      })
    ).toThrow(ValidationError);
  });

  it("tier not an object", () => {
    expect(() =>
      validateCreateProductInput({
        name: "A",
        unit: "kg",
        costPrice: 1,
        currentPrice: 2,
        priceTiers: [3],
      })
    ).toThrow(ValidationError);
  });

  it("tier minQty < 1", () => {
    expect(() =>
      validateCreateProductInput({
        name: "A",
        unit: "kg",
        costPrice: 1,
        currentPrice: 2,
        priceTiers: [{ minQty: 0, price: 5 }],
      })
    ).toThrow(ValidationError);
  });

  it("tier fractional minQty", () => {
    expect(() =>
      validateCreateProductInput({
        name: "A",
        unit: "kg",
        costPrice: 1,
        currentPrice: 2,
        priceTiers: [{ minQty: 2.5, price: 5 }],
      })
    ).toThrow(ValidationError);
  });

  it("tier zero price", () => {
    expect(() =>
      validateCreateProductInput({
        name: "A",
        unit: "kg",
        costPrice: 1,
        currentPrice: 2,
        priceTiers: [{ minQty: 2, price: 0 }],
      })
    ).toThrow(ValidationError);
  });

  it("tier NaN price", () => {
    expect(() =>
      validateCreateProductInput({
        name: "A",
        unit: "kg",
        costPrice: 1,
        currentPrice: 2,
        priceTiers: [{ minQty: 2, price: NaN }],
      })
    ).toThrow(ValidationError);
  });

  it("duplicate tier minQty", () => {
    expect(() =>
      validateCreateProductInput({
        name: "A",
        unit: "kg",
        costPrice: 1,
        currentPrice: 2,
        priceTiers: [
          { minQty: 3, price: 50 },
          { minQty: 3, price: 49 },
        ],
      })
    ).toThrow(ValidationError);
  });

  it("unknown fields ignored", () => {
    const input = validateCreateProductInput({
      name: "A",
      unit: "kg",
      costPrice: 1,
      currentPrice: 2,
      bogus: { nested: true },
      another: 123,
    });
    expect(input).toBeDefined();
  });

  it("returned input shape is clean", () => {
    const input = validateCreateProductInput({
      name: "Biscuit",
      unit: "pack",
      category: "snacks",
      costPrice: 18,
      currentPrice: 20,
      priceTiers: [{ minQty: 3, price: 50 }],
      bogus: "ignored",
    });
    expect(input.name).toBe("Biscuit");
    expect(input.unit).toBe("pack");
    expect(input.category).toBe("snacks");
    expect(input.costPrice).toBe(18);
    expect(input.currentPrice).toBe(20);
    expect(input.priceTiers).toEqual([{ minQty: 3, price: 50 }]);
    expect("bogus" in input).toBe(false);
  });

  it("optional empty fields omitted", () => {
    const input = validateCreateProductInput({
      name: "Rice",
      unit: "kg",
      category: "",
      costPrice: 100,
      currentPrice: 120,
    });
    expect(input.category).toBeUndefined();
    expect(input.priceTiers).toBeUndefined();
  });
});