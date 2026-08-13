// F-04 unit tests for the shared input upper bounds.
//
// Proves every externally supplied numeric quantity/amount rejects over-limit
// values with ValidationError (HTTP 400) and still accepts values at exactly
// the boundary, while preserving the existing lower-bound semantics. Pure
// validator tests — no database access. Uses tsx + node:assert.

import { strict as assert } from "node:assert";
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

let passed = 0;
let failed = 0;

function test(
  name: string,
  fn: () => unknown,
  opts: { message?: RegExp } = {}
): void {
  try {
    fn();
    if (opts.message !== undefined) {
      assert.fail(`${name} was expected to throw ValidationError "${opts.message}"`);
    }
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    if (opts.message !== undefined) {
      if (error instanceof ValidationError) {
        assert.match(error.message, opts.message, `${name} message match`);
        passed++;
        console.log(`PASS  ${name}`);
        return;
      }
      failed++;
      console.error(`FAIL  ${name} (threw ${String(error)}, expected ValidationError)`);
      return;
    }
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
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

// ── Sale validator ───────────────────────────────────────────────────────────
test("sale: quantity exactly MAX passes", () => {
  const input = validateCreateSaleInput(
    saleBody([{ productId: "p1", quantity: MAX_ITEM_QUANTITY }])
  );
  assert.equal(input.items[0].quantity, MAX_ITEM_QUANTITY);
});

test("sale: quantity MAX+1 rejected", () => {
  validateCreateSaleInput(
    saleBody([{ productId: "p1", quantity: MAX_ITEM_QUANTITY + 1 }])
  );
}, { message: /quantity must be at most 100000/ });

test("sale: document with exactly MAX_ITEMS entries passes", () => {
  const input = validateCreateSaleInput(saleBody(itemsOfLength(MAX_ITEMS_PER_DOCUMENT)));
  assert.equal(input.items.length, MAX_ITEMS_PER_DOCUMENT);
});

test("sale: document with MAX_ITEMS+1 entries rejected", () => {
  validateCreateSaleInput(saleBody(itemsOfLength(MAX_ITEMS_PER_DOCUMENT + 1)));
}, { message: /at most 100 entries/ });

test("sale: quantity 0 still rejected (lower bound preserved)", () => {
  validateCreateSaleInput(saleBody([{ productId: "p1", quantity: 0 }]));
}, { message: /positive integer/ });

// ── Purchase validator ───────────────────────────────────────────────────────
test("purchase: quantity + costPerUnit exactly MAX pass", () => {
  const input = validateCreatePurchaseInput(
    purchaseBody([
      { productId: "p1", quantity: MAX_ITEM_QUANTITY, costPerUnit: MAX_AMOUNT },
    ])
  );
  assert.equal(input.items[0].quantity, MAX_ITEM_QUANTITY);
  assert.equal(input.items[0].costPerUnit, MAX_AMOUNT);
});

test("purchase: quantity MAX+1 rejected", () => {
  validateCreatePurchaseInput(
    purchaseBody([
      { productId: "p1", quantity: MAX_ITEM_QUANTITY + 1, costPerUnit: 10 },
    ])
  );
}, { message: /quantity must be at most 100000/ });

test("purchase: costPerUnit MAX+1 rejected", () => {
  validateCreatePurchaseInput(
    purchaseBody([
      { productId: "p1", quantity: 1, costPerUnit: MAX_AMOUNT + 1 },
    ])
  );
}, { message: /costPerUnit must be at most 10000000/ });

test("purchase: document with MAX_ITEMS+1 entries rejected", () => {
  validateCreatePurchaseInput(
    purchaseBody(
      itemsOfLength(MAX_ITEMS_PER_DOCUMENT + 1).map((it) => ({
        ...it,
        costPerUnit: 10,
      }))
    )
  );
}, { message: /at most 100 entries/ });

test("purchase: negative costPerUnit still rejected (lower bound preserved)", () => {
  validateCreatePurchaseInput(
    purchaseBody([{ productId: "p1", quantity: 1, costPerUnit: -1 }])
  );
}, { message: /non-negative number/ });

// ── Stock validator ──────────────────────────────────────────────────────────
test("stock: DAMAGE quantity exactly MAX passes", () => {
  const input = validateAdjustStockInput({
    productId: "p1",
    reason: "DAMAGE",
    quantity: MAX_ITEM_QUANTITY,
  });
  assert.equal(input.quantity, MAX_ITEM_QUANTITY);
});

test("stock: DAMAGE quantity MAX+1 rejected", () => {
  validateAdjustStockInput({
    productId: "p1",
    reason: "DAMAGE",
    quantity: MAX_ITEM_QUANTITY + 1,
  });
}, { message: /quantity must be at most 100000/ });

test("stock: CORRECTION quantity exactly MAX passes", () => {
  const input = validateAdjustStockInput({
    productId: "p1",
    reason: "CORRECTION",
    quantity: MAX_ITEM_QUANTITY,
  });
  assert.equal(input.quantity, MAX_ITEM_QUANTITY);
});

test("stock: CORRECTION quantity MAX+1 rejected", () => {
  validateAdjustStockInput({
    productId: "p1",
    reason: "CORRECTION",
    quantity: MAX_ITEM_QUANTITY + 1,
  });
}, { message: /quantity must be at most 100000/ });

test("stock: CORRECTION negative target still rejected (lower bound preserved)", () => {
  validateAdjustStockInput({ productId: "p1", reason: "CORRECTION", quantity: -1 });
}, { message: /non-negative integer/ });

// ── Customer payment validator ───────────────────────────────────────────────
test("customer-payment: amount exactly MAX passes", () => {
  const input = validateCreateCustomerPaymentInput({
    customerId: "c1",
    amount: MAX_AMOUNT,
  });
  assert.equal(input.amount, MAX_AMOUNT);
});

test("customer-payment: amount MAX+1 rejected", () => {
  validateCreateCustomerPaymentInput({ customerId: "c1", amount: MAX_AMOUNT + 1 });
}, { message: /amount must be at most 10000000/ });

test("customer-payment: zero amount still rejected (lower bound preserved)", () => {
  validateCreateCustomerPaymentInput({ customerId: "c1", amount: 0 });
}, { message: /positive number/ });

// ── Supplier payment validator ───────────────────────────────────────────────
test("supplier-payment: amount exactly MAX passes", () => {
  const input = validateCreateSupplierPaymentInput({
    supplierId: "s1",
    amount: MAX_AMOUNT,
  });
  assert.equal(input.amount, MAX_AMOUNT);
});

test("supplier-payment: amount MAX+1 rejected", () => {
  validateCreateSupplierPaymentInput({ supplierId: "s1", amount: MAX_AMOUNT + 1 });
}, { message: /amount must be at most 10000000/ });

// ── Product validator ────────────────────────────────────────────────────────
const productBody = (overrides: Record<string, unknown> = {}) => ({
  name: "Bound Test",
  unit: "kg",
  costPrice: 100,
  currentPrice: 120,
  ...overrides,
});

test("product: costPrice + currentPrice exactly MAX pass", () => {
  const input = validateCreateProductInput(
    productBody({ costPrice: MAX_AMOUNT, currentPrice: MAX_AMOUNT })
  );
  assert.equal(input.costPrice, MAX_AMOUNT);
  assert.equal(input.currentPrice, MAX_AMOUNT);
});

test("product: costPrice MAX+1 rejected", () => {
  validateCreateProductInput(productBody({ costPrice: MAX_AMOUNT + 1 }));
}, { message: /costPrice must be at most 10000000/ });

test("product: currentPrice MAX+1 rejected", () => {
  validateCreateProductInput(productBody({ currentPrice: MAX_AMOUNT + 1 }));
}, { message: /currentPrice must be at most 10000000/ });

test("product: zero currentPrice still rejected (lower bound preserved)", () => {
  validateCreateProductInput(productBody({ currentPrice: 0 }));
}, { message: /positive number/ });

test("product: tier price + minQty exactly MAX pass", () => {
  const input = validateCreateProductInput(
    productBody({
      priceTiers: [{ minQty: MAX_ITEM_QUANTITY, price: MAX_AMOUNT }],
    })
  );
  assert.equal(input.priceTiers?.[0].minQty, MAX_ITEM_QUANTITY);
  assert.equal(input.priceTiers?.[0].price, MAX_AMOUNT);
});

test("product: tier price MAX+1 rejected", () => {
  validateCreateProductInput(
    productBody({ priceTiers: [{ minQty: 3, price: MAX_AMOUNT + 1 }] })
  );
}, { message: /price must be at most 10000000/ });

test("product: tier minQty MAX+1 rejected", () => {
  validateCreateProductInput(
    productBody({ priceTiers: [{ minQty: MAX_ITEM_QUANTITY + 1, price: 5 }] })
  );
}, { message: /minQty must be at most 100000/ });

// ── Shared constants sanity ──────────────────────────────────────────────────
test("shared constants are positive and ordered sanely", () => {
  assert.ok(MAX_ITEM_QUANTITY > 0);
  assert.ok(MAX_ITEMS_PER_DOCUMENT > 0);
  assert.ok(MAX_AMOUNT > 0);
  assert.ok(MAX_ITEM_QUANTITY < Number.MAX_SAFE_INTEGER);
  assert.ok(MAX_AMOUNT < Number.MAX_SAFE_INTEGER);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);