// F-04 unit tests for the shared input upper bounds (Vitest).
//
// Proves every externally supplied numeric quantity/amount rejects over-limit
// values with ValidationError (HTTP 400) and still accepts values at exactly
// the boundary, while preserving the existing lower-bound semantics. Pure
// validator tests — no database access. Cases identical to the pre-Vitest
// suite.

import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT,
  MAX_ITEM_QUANTITY,
  MAX_ITEMS_PER_DOCUMENT,
} from "../../lib/bounds";
import { ValidationError } from "../../lib/errors";
import { validateCreateProductInput } from "../../modules/products/product.validation";
import { validateCreateSaleInput } from "../../modules/sales/sale.validation";
import {
  validateCreatePurchaseInput,
} from "../../modules/purchases/purchase.validation";
import { validateAdjustStockInput } from "../../modules/stock/stock.validation";
import { validateCreateCustomerPaymentInput } from "../../modules/customer-payments/customer-payment.validation";
import { validateCreateSupplierPaymentInput } from "../../modules/supplier-payments/supplier-payment.validation";

function expectValidationError(fn: () => unknown, pattern: RegExp): void {
  expect(fn).toThrowError(ValidationError);
  expect(fn).toThrowError(pattern);
}

const itemsOfLength = (n: number, quantity = 1) =>
  Array.from({ length: n }, (_, i) => ({
    productId: `00000000-0000-0000-0000-0000000000${(i % 10).toString().padStart(2, "0")}`,
    quantity,
  }));

const saleBody = (items: unknown[]) => ({ paymentType: "CASH", items });
const purchaseBody = (items: unknown[]) => ({
  supplierId: "s1",
  paymentType: "CASH",
  items,
});

describe("shared input upper bounds (F-04)", () => {
  // ── Sale validator ────────────────────────────────────────────────────────
  it("sale: quantity exactly MAX passes", () => {
    const input = validateCreateSaleInput(
      saleBody([{ productId: "p1", quantity: MAX_ITEM_QUANTITY }])
    );
    expect(input.items[0].quantity).toBe(MAX_ITEM_QUANTITY);
  });

  it("sale: quantity MAX+1 rejected", () => {
    expectValidationError(
      () =>
        validateCreateSaleInput(
          saleBody([{ productId: "p1", quantity: MAX_ITEM_QUANTITY + 1 }])
        ),
      /quantity must be at most 100000/
    );
  });

  it("sale: document with exactly MAX_ITEMS entries passes", () => {
    const input = validateCreateSaleInput(saleBody(itemsOfLength(MAX_ITEMS_PER_DOCUMENT)));
    expect(input.items.length).toBe(MAX_ITEMS_PER_DOCUMENT);
  });

  it("sale: document with MAX_ITEMS+1 entries rejected", () => {
    expectValidationError(
      () => validateCreateSaleInput(saleBody(itemsOfLength(MAX_ITEMS_PER_DOCUMENT + 1))),
      /at most 100 entries/
    );
  });

  it("sale: quantity 0 still rejected (lower bound preserved)", () => {
    expectValidationError(
      () => validateCreateSaleInput(saleBody([{ productId: "p1", quantity: 0 }])),
      /positive integer/
    );
  });

  // ── Purchase validator ────────────────────────────────────────────────────
  it("purchase: quantity + costPerUnit exactly MAX pass", () => {
    const input = validateCreatePurchaseInput(
      purchaseBody([
        { productId: "p1", quantity: MAX_ITEM_QUANTITY, costPerUnit: MAX_AMOUNT },
      ])
    );
    expect(input.items[0].quantity).toBe(MAX_ITEM_QUANTITY);
    expect(input.items[0].costPerUnit).toBe(MAX_AMOUNT);
  });

  it("purchase: quantity MAX+1 rejected", () => {
    expectValidationError(
      () =>
        validateCreatePurchaseInput(
          purchaseBody([
            { productId: "p1", quantity: MAX_ITEM_QUANTITY + 1, costPerUnit: 10 },
          ])
        ),
      /quantity must be at most 100000/
    );
  });

  it("purchase: costPerUnit MAX+1 rejected", () => {
    expectValidationError(
      () =>
        validateCreatePurchaseInput(
          purchaseBody([
            { productId: "p1", quantity: 1, costPerUnit: MAX_AMOUNT + 1 },
          ])
        ),
      /costPerUnit must be at most 10000000/
    );
  });

  it("purchase: document with MAX_ITEMS+1 entries rejected", () => {
    expectValidationError(
      () =>
        validateCreatePurchaseInput(
          purchaseBody(
            itemsOfLength(MAX_ITEMS_PER_DOCUMENT + 1).map((it) => ({
              ...it,
              costPerUnit: 10,
            }))
          )
        ),
      /at most 100 entries/
    );
  });

  it("purchase: negative costPerUnit still rejected (lower bound preserved)", () => {
    expectValidationError(
      () =>
        validateCreatePurchaseInput(
          purchaseBody([{ productId: "p1", quantity: 1, costPerUnit: -1 }])
        ),
      /non-negative number/
    );
  });

  // ── Stock validator ───────────────────────────────────────────────────────
  it("stock: DAMAGE quantity exactly MAX passes", () => {
    const input = validateAdjustStockInput({
      productId: "p1",
      reason: "DAMAGE",
      quantity: MAX_ITEM_QUANTITY,
    });
    expect(input.quantity).toBe(MAX_ITEM_QUANTITY);
  });

  it("stock: DAMAGE quantity MAX+1 rejected", () => {
    expectValidationError(
      () =>
        validateAdjustStockInput({
          productId: "p1",
          reason: "DAMAGE",
          quantity: MAX_ITEM_QUANTITY + 1,
        }),
      /quantity must be at most 100000/
    );
  });

  it("stock: CORRECTION quantity exactly MAX passes", () => {
    const input = validateAdjustStockInput({
      productId: "p1",
      reason: "CORRECTION",
      quantity: MAX_ITEM_QUANTITY,
    });
    expect(input.quantity).toBe(MAX_ITEM_QUANTITY);
  });

  it("stock: CORRECTION quantity MAX+1 rejected", () => {
    expectValidationError(
      () =>
        validateAdjustStockInput({
          productId: "p1",
          reason: "CORRECTION",
          quantity: MAX_ITEM_QUANTITY + 1,
        }),
      /quantity must be at most 100000/
    );
  });

  it("stock: CORRECTION negative target still rejected (lower bound preserved)", () => {
    expectValidationError(
      () => validateAdjustStockInput({ productId: "p1", reason: "CORRECTION", quantity: -1 }),
      /non-negative integer/
    );
  });

  // ── Customer payment validator ────────────────────────────────────────────
  it("customer-payment: amount exactly MAX passes", () => {
    const input = validateCreateCustomerPaymentInput({
      customerId: "c1",
      amount: MAX_AMOUNT,
    });
    expect(input.amount).toBe(MAX_AMOUNT);
  });

  it("customer-payment: amount MAX+1 rejected", () => {
    expectValidationError(
      () => validateCreateCustomerPaymentInput({ customerId: "c1", amount: MAX_AMOUNT + 1 }),
      /amount must be at most 10000000/
    );
  });

  it("customer-payment: zero amount still rejected (lower bound preserved)", () => {
    expectValidationError(
      () => validateCreateCustomerPaymentInput({ customerId: "c1", amount: 0 }),
      /positive number/
    );
  });

  // ── Supplier payment validator ────────────────────────────────────────────
  it("supplier-payment: amount exactly MAX passes", () => {
    const input = validateCreateSupplierPaymentInput({
      supplierId: "s1",
      amount: MAX_AMOUNT,
    });
    expect(input.amount).toBe(MAX_AMOUNT);
  });

  it("supplier-payment: amount MAX+1 rejected", () => {
    expectValidationError(
      () => validateCreateSupplierPaymentInput({ supplierId: "s1", amount: MAX_AMOUNT + 1 }),
      /amount must be at most 10000000/
    );
  });

  // ── Product validator ─────────────────────────────────────────────────────
  const productBody = (overrides: Record<string, unknown> = {}) => ({
    name: "Bound Test",
    unit: "kg",
    costPrice: 100,
    currentPrice: 120,
    ...overrides,
  });

  it("product: costPrice + currentPrice exactly MAX pass", () => {
    const input = validateCreateProductInput(
      productBody({ costPrice: MAX_AMOUNT, currentPrice: MAX_AMOUNT })
    );
    expect(input.costPrice).toBe(MAX_AMOUNT);
    expect(input.currentPrice).toBe(MAX_AMOUNT);
  });

  it("product: costPrice MAX+1 rejected", () => {
    expectValidationError(
      () => validateCreateProductInput(productBody({ costPrice: MAX_AMOUNT + 1 })),
      /costPrice must be at most 10000000/
    );
  });

  it("product: currentPrice MAX+1 rejected", () => {
    expectValidationError(
      () => validateCreateProductInput(productBody({ currentPrice: MAX_AMOUNT + 1 })),
      /currentPrice must be at most 10000000/
    );
  });

  it("product: zero currentPrice still rejected (lower bound preserved)", () => {
    expectValidationError(
      () => validateCreateProductInput(productBody({ currentPrice: 0 })),
      /positive number/
    );
  });

  it("product: tier price + minQty exactly MAX pass", () => {
    const input = validateCreateProductInput(
      productBody({
        priceTiers: [{ minQty: MAX_ITEM_QUANTITY, price: MAX_AMOUNT }],
      })
    );
    expect(input.priceTiers?.[0].minQty).toBe(MAX_ITEM_QUANTITY);
    expect(input.priceTiers?.[0].price).toBe(MAX_AMOUNT);
  });

  it("product: tier price MAX+1 rejected", () => {
    expectValidationError(
      () =>
        validateCreateProductInput(
          productBody({ priceTiers: [{ minQty: 3, price: MAX_AMOUNT + 1 }] })
        ),
      /price must be at most 10000000/
    );
  });

  it("product: tier minQty MAX+1 rejected", () => {
    expectValidationError(
      () =>
        validateCreateProductInput(
          productBody({ priceTiers: [{ minQty: MAX_ITEM_QUANTITY + 1, price: 5 }] })
        ),
      /minQty must be at most 100000/
    );
  });

  it("shared constants are positive and ordered sanely", () => {
    expect(MAX_ITEM_QUANTITY).toBeGreaterThan(0);
    expect(MAX_ITEMS_PER_DOCUMENT).toBeGreaterThan(0);
    expect(MAX_AMOUNT).toBeGreaterThan(0);
    expect(MAX_ITEM_QUANTITY).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(MAX_AMOUNT).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});