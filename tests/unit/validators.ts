// Validator unit suite — request-level validation for the D1–D7 write flows.
//
// Covers the six validators (sale, purchase, stock adjustment, customer
// payment, supplier payment) and the report date-range parser/coercer.
// Success returns the cleaned input; every failure throws ValidationError
// (HTTP 400). Pure logic, no DB (tsx + node:assert).

import { strict as assert } from "node:assert";
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
import { createUnit } from "../helpers/runner";

const { test, finish } = createUnit();

function throwsValidation(fn: () => unknown, pattern?: RegExp): void {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    assert.ok(
      error instanceof ValidationError,
      `expected ValidationError, got ${(error as Error).constructor.name}: ${(error as Error).message}`
    );
    if (pattern) assert.match((error as Error).message, pattern);
  }
  assert.ok(threw, "expected a ValidationError to be thrown");
}

// ── Sales (D1) ────────────────────────────────────────────────────────────────
test("sale: valid CASH without customerId", () => {
  const out = validateCreateSaleInput({
    paymentType: "CASH",
    items: [{ productId: "p1", quantity: 2 }],
  });
  assert.deepEqual(out, { paymentType: "CASH", items: [{ productId: "p1", quantity: 2 }] });
});

test("sale: valid CREDIT keeps customerId", () => {
  const out = validateCreateSaleInput({
    paymentType: "CREDIT",
    customerId: "c1",
    items: [{ productId: "p1", quantity: 1 }],
  });
  assert.equal(out.paymentType, "CREDIT");
  assert.equal(out.customerId, "c1");
});

test("sale: ECASH is accepted", () => {
  const out = validateCreateSaleInput({
    paymentType: "ECASH",
    items: [{ productId: "p1", quantity: 1 }],
  });
  assert.equal(out.paymentType, "ECASH");
});

test("sale: non-object body rejected", () => {
  throwsValidation(() => validateCreateSaleInput("nope"), /must be a JSON object/);
  throwsValidation(() => validateCreateSaleInput(null), /must be a JSON object/);
});

test("sale: unknown paymentType rejected", () => {
  throwsValidation(
    () => validateCreateSaleInput({ paymentType: "IOU", items: [] }),
    /paymentType must be one of/
  );
});

test("sale: empty items rejected", () => {
  throwsValidation(
    () => validateCreateSaleInput({ paymentType: "CASH", items: [] }),
    /items must be a non-empty array/
  );
});

test("sale: quantity must be a positive integer", () => {
  const base = { paymentType: "CASH" as const, items: [{ productId: "p1", quantity: 0 }] };
  throwsValidation(() => validateCreateSaleInput(base), /positive integer/);
  throwsValidation(
    () => validateCreateSaleInput({ ...base, items: [{ productId: "p1", quantity: -1 }] }),
    /positive integer/
  );
  throwsValidation(
    () => validateCreateSaleInput({ ...base, items: [{ productId: "p1", quantity: 1.5 }] }),
    /positive integer/
  );
});

test("sale: item must be an object with a productId", () => {
  throwsValidation(
    () => validateCreateSaleInput({ paymentType: "CASH", items: ["nope"] }),
    /items\[0\] must be an object/
  );
  throwsValidation(
    () => validateCreateSaleInput({ paymentType: "CASH", items: [{ quantity: 1 }] }),
    /items\[0\]\.productId/
  );
});

test("sale: quantity above the F-04 cap rejected", () => {
  throwsValidation(
    () =>
      validateCreateSaleInput({
        paymentType: "CASH",
        items: [{ productId: "p1", quantity: MAX_ITEM_QUANTITY + 1 }],
      }),
    /must be at most/
  );
});

test("sale: too many line items rejected", () => {
  const items = Array.from({ length: MAX_ITEMS_PER_DOCUMENT + 1 }, () => ({
    productId: "p1",
    quantity: 1,
  }));
  throwsValidation(
    () => validateCreateSaleInput({ paymentType: "CASH", items }),
    /at most 100 entries/
  );
});

test("sale: non-string customerId rejected", () => {
  throwsValidation(
    () =>
      validateCreateSaleInput({
        paymentType: "CREDIT",
        customerId: 42,
        items: [{ productId: "p1", quantity: 1 }],
      }),
    /customerId/
  );
});

// ── Purchases (D2/D3) ─────────────────────────────────────────────────────────
test("purchase: valid CASH", () => {
  const out = validateCreatePurchaseInput({
    supplierId: "s1",
    paymentType: "CASH",
    items: [{ productId: "p1", quantity: 5, costPerUnit: 20 }],
  });
  assert.deepEqual(out, {
    supplierId: "s1",
    paymentType: "CASH",
    items: [{ productId: "p1", quantity: 5, costPerUnit: 20 }],
  });
});

test("purchase: valid CREDIT", () => {
  const out = validateCreatePurchaseInput({
    supplierId: "s1",
    paymentType: "CREDIT",
    items: [{ productId: "p1", quantity: 2, costPerUnit: 15 }],
  });
  assert.equal(out.paymentType, "CREDIT");
});

test("purchase: missing supplierId / bad paymentType rejected", () => {
  throwsValidation(
    () =>
      validateCreatePurchaseInput({
        paymentType: "CASH",
        items: [{ productId: "p1", quantity: 1, costPerUnit: 1 }],
      }),
    /supplierId/
  );
  throwsValidation(
    () =>
      validateCreatePurchaseInput({
        supplierId: "s1",
        paymentType: "LAYAWAY",
        items: [{ productId: "p1", quantity: 1, costPerUnit: 1 }],
      }),
    /paymentType must be one of/
  );
});

test("purchase: quantity rules", () => {
  throwsValidation(
    () =>
      validateCreatePurchaseInput({
        supplierId: "s1",
        paymentType: "CASH",
        items: [{ productId: "p1", quantity: 0, costPerUnit: 1 }],
      }),
    /positive integer/
  );
  throwsValidation(
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

test("purchase: costPerUnit must be a non-negative finite number", () => {
  throwsValidation(
    () =>
      validateCreatePurchaseInput({
        supplierId: "s1",
        paymentType: "CASH",
        items: [{ productId: "p1", quantity: 1, costPerUnit: -5 }],
      }),
    /non-negative/
  );
  throwsValidation(
    () =>
      validateCreatePurchaseInput({
        supplierId: "s1",
        paymentType: "CASH",
        items: [{ productId: "p1", quantity: 1, costPerUnit: NaN }],
      }),
    /non-negative/
  );
  throwsValidation(
    () =>
      validateCreatePurchaseInput({
        supplierId: "s1",
        paymentType: "CASH",
        items: [{ productId: "p1", quantity: 1, costPerUnit: MAX_AMOUNT + 1 }],
      }),
    /must be at most/
  );
});

// ── Stock adjustments (D6) ────────────────────────────────────────────────────
test("stock: DAMAGE requires a positive integer quantity", () => {
  const base = { productId: "p1", reason: "DAMAGE" as const };
  assert.deepEqual(validateAdjustStockInput({ ...base, quantity: 3 }), {
    productId: "p1",
    reason: "DAMAGE",
    quantity: 3,
  });
  throwsValidation(() => validateAdjustStockInput({ ...base, quantity: 0 }), /positive integer/);
  throwsValidation(() => validateAdjustStockInput({ ...base, quantity: -2 }), /positive integer/);
  throwsValidation(() => validateAdjustStockInput({ ...base, quantity: 2.5 }), /positive integer/);
});

test("stock: CORRECTION accepts a zero target (desired final level)", () => {
  assert.deepEqual(validateAdjustStockInput({ productId: "p1", reason: "CORRECTION", quantity: 0 }), {
    productId: "p1",
    reason: "CORRECTION",
    quantity: 0,
  });
  throwsValidation(
    () =>
      validateAdjustStockInput({
        productId: "p1",
        reason: "CORRECTION",
        quantity: -1,
      }),
    /non-negative/
  );
});

test("stock: unknown reason / bad note rejected", () => {
  throwsValidation(
    () => validateAdjustStockInput({ productId: "p1", reason: "THEFT", quantity: 1 }),
    /reason must be one of/
  );
  throwsValidation(
    () =>
      validateAdjustStockInput({ productId: "p1", reason: "DAMAGE", quantity: 1, note: 7 }),
    /note/
  );
});

test("stock: quantity above the F-04 cap rejected", () => {
  throwsValidation(
    () =>
      validateAdjustStockInput({
        productId: "p1",
        reason: "DAMAGE",
        quantity: MAX_ITEM_QUANTITY + 1,
      }),
    /must be at most/
  );
});

// ── Customer payments (D4/D5) ─────────────────────────────────────────────────
test("customer-payment: valid plain and sale-linked", () => {
  assert.deepEqual(validateCreateCustomerPaymentInput({ customerId: "c1", amount: 100 }), {
    customerId: "c1",
    amount: 100,
  });
  const linked = validateCreateCustomerPaymentInput({
    customerId: "c1",
    amount: 100,
    saleId: "s1",
  });
  assert.equal(linked.saleId, "s1");
});

test("customer-payment: amount / customerId / saleId rules", () => {
  throwsValidation(() => validateCreateCustomerPaymentInput({ amount: 100 }), /customerId/);
  throwsValidation(() => validateCreateCustomerPaymentInput({ customerId: "c1", amount: 0 }), /positive/);
  throwsValidation(() => validateCreateCustomerPaymentInput({ customerId: "c1", amount: -5 }), /positive/);
  throwsValidation(() => validateCreateCustomerPaymentInput({ customerId: "c1", amount: NaN }), /positive/);
  throwsValidation(
    () => validateCreateCustomerPaymentInput({ customerId: "c1", amount: MAX_AMOUNT + 1 }),
    /must be at most/
  );
  throwsValidation(
    () => validateCreateCustomerPaymentInput({ customerId: "c1", amount: 1, saleId: 7 }),
    /saleId/
  );
});

// ── Supplier payments (D3) ────────────────────────────────────────────────────
test("supplier-payment: valid", () => {
  assert.deepEqual(validateCreateSupplierPaymentInput({ supplierId: "s1", amount: 50 }), {
    supplierId: "s1",
    amount: 50,
  });
});

test("supplier-payment: amount / supplierId rules", () => {
  throwsValidation(() => validateCreateSupplierPaymentInput({ amount: 50 }), /supplierId/);
  throwsValidation(() => validateCreateSupplierPaymentInput({ supplierId: "s1", amount: 0 }), /positive/);
  throwsValidation(() => validateCreateSupplierPaymentInput({ supplierId: "s1", amount: -1 }), /positive/);
  throwsValidation(
    () => validateCreateSupplierPaymentInput({ supplierId: "s1", amount: MAX_AMOUNT + 1 }),
    /must be at most/
  );
});

// ── Report date ranges (D7) ───────────────────────────────────────────────────
test("report range: no params = full history", () => {
  assert.deepEqual(parseReportDateRange(new URLSearchParams()), {});
});

test("report range: valid from/to parsed", () => {
  const range = parseReportDateRange(
    new URLSearchParams("?from=2026-08-01T00:00:00.000&to=2026-08-13T23:59:59.999")
  );
  assert.ok(range.from instanceof Date);
  assert.ok(range.to instanceof Date);
});

test("report range: invalid date rejected", () => {
  throwsValidation(
    () => parseReportDateRange(new URLSearchParams("?from=not-a-date")),
    /valid ISO-8601 date/
  );
  throwsValidation(
    () => parseReportDateRange(new URLSearchParams("?to=2026-99-99")),
    /valid ISO-8601 date/
  );
});

test("report range: inverted from > to rejected", () => {
  throwsValidation(
    () => parseReportDateRange(new URLSearchParams("?from=2026-09-01&to=2026-08-01")),
    /from must not be later than to/
  );
});

test("report range: yyyy-mm-dd coerced to local midnight / end-of-day", () => {
  const coerced = coerceRangeQuery(new URLSearchParams("?from=2026-08-13&to=2026-08-13"));
  assert.equal(coerced.get("from"), "2026-08-13T00:00:00.000");
  assert.equal(coerced.get("to"), "2026-08-13T23:59:59.999");
});

test("report range: full ISO timestamps are left untouched", () => {
  const coerced = coerceRangeQuery(new URLSearchParams("?from=2026-08-13T10:00:00.000Z"));
  assert.equal(coerced.get("from"), "2026-08-13T10:00:00.000Z");
});

const exitCode = finish();
process.exit(exitCode);