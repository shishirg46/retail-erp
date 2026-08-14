// Validator unit suite — request-level validation for the D1–D7 write flows
// (Vitest).
//
// Covers the six validators (sale, purchase, stock adjustment, customer
// payment, supplier payment) and the report date-range parser/coercer.
// Success returns the cleaned input; every failure throws ValidationError
// (HTTP 400). Pure logic, no DB. Cases identical to the pre-Vitest suite.

import { describe, expect, it } from "vitest";
import { ValidationError } from "../../lib/errors";
import {
  MAX_AMOUNT,
  MAX_ITEM_QUANTITY,
  MAX_ITEMS_PER_DOCUMENT,
} from "../../lib/bounds";
import { validateCreateSaleInput } from "../../modules/sales/sale.validation";
import { validateCreatePurchaseInput } from "../../modules/purchases/purchase.validation";
import { validateAdjustStockInput } from "../../modules/stock/stock.validation";
import { validateCreateCustomerPaymentInput } from "../../modules/customer-payments/customer-payment.validation";
import { validateCreateSupplierPaymentInput } from "../../modules/supplier-payments/supplier-payment.validation";
import {
  coerceRangeQuery,
  parseReportDateRange,
} from "../../modules/reports/report.validation";

function expectValidationError(fn: () => unknown, pattern: RegExp): void {
  expect(fn).toThrowError(ValidationError);
  expect(fn).toThrowError(pattern);
}

describe("D1–D7 request validators", () => {
  // ── Sales (D1) ─────────────────────────────────────────────────────────────
  it("sale: valid CASH without customerId", () => {
    const out = validateCreateSaleInput({
      paymentType: "CASH",
      items: [{ productId: "p1", quantity: 2 }],
    });
    expect(out).toEqual({ paymentType: "CASH", items: [{ productId: "p1", quantity: 2 }] });
  });

  it("sale: valid CREDIT keeps customerId", () => {
    const out = validateCreateSaleInput({
      paymentType: "CREDIT",
      customerId: "c1",
      items: [{ productId: "p1", quantity: 1 }],
    });
    expect(out.paymentType).toBe("CREDIT");
    expect(out.customerId).toBe("c1");
  });

  it("sale: ECASH is accepted", () => {
    const out = validateCreateSaleInput({
      paymentType: "ECASH",
      items: [{ productId: "p1", quantity: 1 }],
    });
    expect(out.paymentType).toBe("ECASH");
  });

  it("sale: non-object body rejected", () => {
    expectValidationError(() => validateCreateSaleInput("nope"), /must be a JSON object/);
    expectValidationError(() => validateCreateSaleInput(null), /must be a JSON object/);
  });

  it("sale: unknown paymentType rejected", () => {
    expectValidationError(
      () => validateCreateSaleInput({ paymentType: "IOU", items: [] }),
      /paymentType must be one of/
    );
  });

  it("sale: empty items rejected", () => {
    expectValidationError(
      () => validateCreateSaleInput({ paymentType: "CASH", items: [] }),
      /items must be a non-empty array/
    );
  });

  it("sale: quantity must be a positive integer", () => {
    const base = { paymentType: "CASH" as const, items: [{ productId: "p1", quantity: 0 }] };
    expectValidationError(() => validateCreateSaleInput(base), /positive integer/);
    expectValidationError(
      () => validateCreateSaleInput({ ...base, items: [{ productId: "p1", quantity: -1 }] }),
      /positive integer/
    );
    expectValidationError(
      () => validateCreateSaleInput({ ...base, items: [{ productId: "p1", quantity: 1.5 }] }),
      /positive integer/
    );
  });

  it("sale: item must be an object with a productId", () => {
    expectValidationError(
      () => validateCreateSaleInput({ paymentType: "CASH", items: ["nope"] }),
      /items\[0\] must be an object/
    );
    expectValidationError(
      () => validateCreateSaleInput({ paymentType: "CASH", items: [{ quantity: 1 }] }),
      /items\[0\]\.productId/
    );
  });

  it("sale: quantity above the F-04 cap rejected", () => {
    expectValidationError(
      () =>
        validateCreateSaleInput({
          paymentType: "CASH",
          items: [{ productId: "p1", quantity: MAX_ITEM_QUANTITY + 1 }],
        }),
      /must be at most/
    );
  });

  it("sale: too many line items rejected", () => {
    const items = Array.from({ length: MAX_ITEMS_PER_DOCUMENT + 1 }, () => ({
      productId: "p1",
      quantity: 1,
    }));
    expectValidationError(
      () => validateCreateSaleInput({ paymentType: "CASH", items }),
      /at most 100 entries/
    );
  });

  it("sale: non-string customerId rejected", () => {
    expectValidationError(
      () =>
        validateCreateSaleInput({
          paymentType: "CREDIT",
          customerId: 42,
          items: [{ productId: "p1", quantity: 1 }],
        }),
      /customerId/
    );
  });

  // ── Purchases (D2/D3) ───────────────────────────────────────────────────────
  it("purchase: valid CASH", () => {
    const out = validateCreatePurchaseInput({
      supplierId: "s1",
      paymentType: "CASH",
      items: [{ productId: "p1", quantity: 5, costPerUnit: 20 }],
    });
    expect(out).toEqual({
      supplierId: "s1",
      paymentType: "CASH",
      items: [{ productId: "p1", quantity: 5, costPerUnit: 2000 }],
    });
  });

  it("purchase: valid CREDIT", () => {
    const out = validateCreatePurchaseInput({
      supplierId: "s1",
      paymentType: "CREDIT",
      items: [{ productId: "p1", quantity: 2, costPerUnit: 15 }],
    });
    expect(out.paymentType).toBe("CREDIT");
  });

  it("purchase: missing supplierId / bad paymentType rejected", () => {
    expectValidationError(
      () =>
        validateCreatePurchaseInput({
          paymentType: "CASH",
          items: [{ productId: "p1", quantity: 1, costPerUnit: 1 }],
        }),
      /supplierId/
    );
    expectValidationError(
      () =>
        validateCreatePurchaseInput({
          supplierId: "s1",
          paymentType: "LAYAWAY",
          items: [{ productId: "p1", quantity: 1, costPerUnit: 1 }],
        }),
      /paymentType must be one of/
    );
  });

  it("purchase: quantity rules", () => {
    expectValidationError(
      () =>
        validateCreatePurchaseInput({
          supplierId: "s1",
          paymentType: "CASH",
          items: [{ productId: "p1", quantity: 0, costPerUnit: 1 }],
        }),
      /positive integer/
    );
    expectValidationError(
      () =>
        validateCreatePurchaseInput({
          supplierId: "s1",
          paymentType: "CASH",
          items: [
            { productId: "p1", quantity: 1, costPerUnit: 1 },
            { productId: "p2", quantity: MAX_ITEM_QUANTITY + 1, costPerUnit: 1 },
          ],
        }),
      /must be at most/
    );
  });

  it("purchase: costPerUnit must be a non-negative finite number", () => {
    expectValidationError(
      () =>
        validateCreatePurchaseInput({
          supplierId: "s1",
          paymentType: "CASH",
          items: [{ productId: "p1", quantity: 1, costPerUnit: -5 }],
        }),
      /non-negative/
    );
    expectValidationError(
      () =>
        validateCreatePurchaseInput({
          supplierId: "s1",
          paymentType: "CASH",
          items: [{ productId: "p1", quantity: 1, costPerUnit: NaN }],
        }),
      /non-negative/
    );
    expectValidationError(
      () =>
        validateCreatePurchaseInput({
          supplierId: "s1",
          paymentType: "CASH",
          items: [{ productId: "p1", quantity: 1, costPerUnit: MAX_AMOUNT + 1 }],
        }),
      /must be at most/
    );
  });

  // ── Stock adjustments (D6) ──────────────────────────────────────────────────
  it("stock: DAMAGE requires a positive integer quantity", () => {
    const base = { productId: "p1", reason: "DAMAGE" as const };
    expect(validateAdjustStockInput({ ...base, quantity: 3 })).toEqual({
      productId: "p1",
      reason: "DAMAGE",
      quantity: 3,
    });
    expectValidationError(() => validateAdjustStockInput({ ...base, quantity: 0 }), /positive integer/);
    expectValidationError(() => validateAdjustStockInput({ ...base, quantity: -2 }), /positive integer/);
    expectValidationError(() => validateAdjustStockInput({ ...base, quantity: 2.5 }), /positive integer/);
  });

  it("stock: CORRECTION accepts a zero target (desired final level)", () => {
    expect(validateAdjustStockInput({ productId: "p1", reason: "CORRECTION", quantity: 0 })).toEqual({
      productId: "p1",
      reason: "CORRECTION",
      quantity: 0,
    });
    expectValidationError(
      () =>
        validateAdjustStockInput({
          productId: "p1",
          reason: "CORRECTION",
          quantity: -1,
        }),
      /non-negative/
    );
  });

  it("stock: unknown reason / bad note rejected", () => {
    expectValidationError(
      () => validateAdjustStockInput({ productId: "p1", reason: "THEFT", quantity: 1 }),
      /reason must be one of/
    );
    expectValidationError(
      () =>
        validateAdjustStockInput({ productId: "p1", reason: "DAMAGE", quantity: 1, note: 7 }),
      /note/
    );
  });

  it("stock: quantity above the F-04 cap rejected", () => {
    expectValidationError(
      () =>
        validateAdjustStockInput({
          productId: "p1",
          reason: "DAMAGE",
          quantity: MAX_ITEM_QUANTITY + 1,
        }),
      /must be at most/
    );
  });

  // ── Customer payments (D4/D5) ───────────────────────────────────────────────
  it("customer-payment: valid plain and sale-linked", () => {
    expect(validateCreateCustomerPaymentInput({ customerId: "c1", amount: 100 })).toEqual({
      customerId: "c1",
      amount: 10000,
    });
    const linked = validateCreateCustomerPaymentInput({
      customerId: "c1",
      amount: 100,
      saleId: "s1",
    });
    expect(linked.saleId).toBe("s1");
  });

  it("customer-payment: amount / customerId / saleId rules", () => {
    expectValidationError(() => validateCreateCustomerPaymentInput({ amount: 100 }), /customerId/);
    expectValidationError(() => validateCreateCustomerPaymentInput({ customerId: "c1", amount: 0 }), /positive/);
    expectValidationError(() => validateCreateCustomerPaymentInput({ customerId: "c1", amount: -5 }), /positive/);
    expectValidationError(() => validateCreateCustomerPaymentInput({ customerId: "c1", amount: NaN }), /positive/);
    expectValidationError(
      () => validateCreateCustomerPaymentInput({ customerId: "c1", amount: MAX_AMOUNT + 1 }),
      /must be at most/
    );
    expectValidationError(
      () => validateCreateCustomerPaymentInput({ customerId: "c1", amount: 1, saleId: 7 }),
      /saleId/
    );
  });

  // ── Supplier payments (D3) ──────────────────────────────────────────────────
  it("supplier-payment: valid", () => {
    expect(validateCreateSupplierPaymentInput({ supplierId: "s1", amount: 50 })).toEqual({
      supplierId: "s1",
      amount: 5000,
    });
  });

  it("supplier-payment: amount / supplierId rules", () => {
    expectValidationError(() => validateCreateSupplierPaymentInput({ amount: 50 }), /supplierId/);
    expectValidationError(() => validateCreateSupplierPaymentInput({ supplierId: "s1", amount: 0 }), /positive/);
    expectValidationError(() => validateCreateSupplierPaymentInput({ supplierId: "s1", amount: -1 }), /positive/);
    expectValidationError(
      () => validateCreateSupplierPaymentInput({ supplierId: "s1", amount: MAX_AMOUNT + 1 }),
      /must be at most/
    );
  });

  // ── Report date ranges (D7) ─────────────────────────────────────────────────
  it("report range: no params = full history", () => {
    expect(parseReportDateRange(new URLSearchParams())).toEqual({});
  });

  it("report range: valid from/to parsed", () => {
    const range = parseReportDateRange(
      new URLSearchParams("?from=2026-08-01T00:00:00.000&to=2026-08-13T23:59:59.999")
    );
    expect(range.from).toBeInstanceOf(Date);
    expect(range.to).toBeInstanceOf(Date);
  });

  it("report range: invalid date rejected", () => {
    expectValidationError(
      () => parseReportDateRange(new URLSearchParams("?from=not-a-date")),
      /valid ISO-8601 date/
    );
    expectValidationError(
      () => parseReportDateRange(new URLSearchParams("?to=2026-99-99")),
      /valid ISO-8601 date/
    );
  });

  it("report range: inverted from > to rejected", () => {
    expectValidationError(
      () => parseReportDateRange(new URLSearchParams("?from=2026-09-01&to=2026-08-01")),
      /from must not be later than to/
    );
  });

  it("report range: yyyy-mm-dd coerced to local midnight / end-of-day", () => {
    const coerced = coerceRangeQuery(new URLSearchParams("?from=2026-08-13&to=2026-08-13"));
    expect(coerced.get("from")).toBe("2026-08-13T00:00:00.000");
    expect(coerced.get("to")).toBe("2026-08-13T23:59:59.999");
  });

  it("report range: full ISO timestamps are left untouched", () => {
    const coerced = coerceRangeQuery(new URLSearchParams("?from=2026-08-13T10:00:00.000Z"));
    expect(coerced.get("from")).toBe("2026-08-13T10:00:00.000Z");
  });
});