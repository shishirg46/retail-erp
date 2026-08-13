// F-01 unit tests for validateCreateProductInput.
//
// Pure validator tests — no database access, so the development database is
// untouchable by construction. Uses tsx + node:assert (no test framework).

import { strict as assert } from "node:assert";
import { ValidationError } from "../../lib/errors";
import { validateCreateProductInput } from "../../modules/products/product.validation";

let passed = 0;
let failed = 0;

function expectPass(name: string, body: unknown): void {
  try {
    const input = validateCreateProductInput(body);
    assert.ok(input, "returns an input");
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

function expectValidationError(name: string, body: unknown): void {
  try {
    validateCreateProductInput(body);
    failed++;
    console.error(`FAIL  ${name} (expected ValidationError, got none)`);
  } catch (error) {
    if (error instanceof ValidationError) {
      passed++;
      console.log(`PASS  ${name}`);
    } else {
      failed++;
      console.error(`FAIL  ${name} (threw ${String(error)} instead of ValidationError)`);
    }
  }
}

// 1. Valid full product (with tiers).
expectPass("valid full product", {
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

// 2. Valid product without optional fields.
expectPass("valid product, no category/tiers", {
  name: "Rice",
  unit: "kg",
  costPrice: 100,
  currentPrice: 120,
});

// 3. Non-object body.
expectValidationError("non-object body", "hello");
expectValidationError("null body", null);

// 4. name validation.
expectValidationError("missing name", { unit: "kg", costPrice: 1, currentPrice: 2 });
expectValidationError("empty name", { name: "", unit: "kg", costPrice: 1, currentPrice: 2 });
expectValidationError("whitespace name", { name: "   ", unit: "kg", costPrice: 1, currentPrice: 2 });
expectValidationError("non-string name", { name: 42, unit: "kg", costPrice: 1, currentPrice: 2 });
expectValidationError("over-long name", {
  name: "x".repeat(201),
  unit: "kg",
  costPrice: 1,
  currentPrice: 2,
});

// 5. unit validation.
expectValidationError("missing unit", { name: "Rice", costPrice: 1, currentPrice: 2 });
expectValidationError("empty unit", { name: "Rice", unit: "", costPrice: 1, currentPrice: 2 });
expectValidationError("over-long unit", {
  name: "Rice",
  unit: "x".repeat(51),
  costPrice: 1,
  currentPrice: 2,
});

// 6. Price validation.
expectValidationError("negative costPrice", { name: "A", unit: "kg", costPrice: -1, currentPrice: 2 });
expectValidationError("NaN costPrice", { name: "A", unit: "kg", costPrice: NaN, currentPrice: 2 });
expectValidationError("Infinity costPrice", { name: "A", unit: "kg", costPrice: Infinity, currentPrice: 2 });
expectValidationError("non-number costPrice", { name: "A", unit: "kg", costPrice: "5", currentPrice: 2 });
expectValidationError("missing costPrice", { name: "A", unit: "kg", currentPrice: 2 });
expectValidationError("zero currentPrice", { name: "A", unit: "kg", costPrice: 1, currentPrice: 0 });
expectValidationError("negative currentPrice", { name: "A", unit: "kg", costPrice: 1, currentPrice: -5 });
expectValidationError("NaN currentPrice", { name: "A", unit: "kg", costPrice: 1, currentPrice: NaN });

// 7. priceTiers validation.
expectValidationError("non-array priceTiers", {
  name: "A", unit: "kg", costPrice: 1, currentPrice: 2,
  priceTiers: "hello",
});
expectValidationError("tier not an object", {
  name: "A", unit: "kg", costPrice: 1, currentPrice: 2,
  priceTiers: [3],
});
expectValidationError("tier minQty < 1", {
  name: "A", unit: "kg", costPrice: 1, currentPrice: 2,
  priceTiers: [{ minQty: 0, price: 5 }],
});
expectValidationError("tier fractional minQty", {
  name: "A", unit: "kg", costPrice: 1, currentPrice: 2,
  priceTiers: [{ minQty: 2.5, price: 5 }],
});
expectValidationError("tier zero price", {
  name: "A", unit: "kg", costPrice: 1, currentPrice: 2,
  priceTiers: [{ minQty: 2, price: 0 }],
});
expectValidationError("tier NaN price", {
  name: "A", unit: "kg", costPrice: 1, currentPrice: 2,
  priceTiers: [{ minQty: 2, price: NaN }],
});

// 8. Duplicate minQty in one payload.
expectValidationError("duplicate tier minQty", {
  name: "A", unit: "kg", costPrice: 1, currentPrice: 2,
  priceTiers: [
    { minQty: 3, price: 50 },
    { minQty: 3, price: 49 },
  ],
});

// 9. Unknown fields ignored (no throw, not in returned input).
expectPass("unknown fields ignored", {
  name: "A",
  unit: "kg",
  costPrice: 1,
  currentPrice: 2,
  bogus: { nested: true },
  another: 123,
});

{
  const input = validateCreateProductInput({
    name: "Biscuit",
    unit: "pack",
    category: "snacks",
    costPrice: 18,
    currentPrice: 20,
    priceTiers: [{ minQty: 3, price: 50 }],
    bogus: "ignored",
  });
  assert.equal(input.name, "Biscuit");
  assert.equal(input.unit, "pack");
  assert.equal(input.category, "snacks");
  assert.equal(input.costPrice, 18);
  assert.equal(input.currentPrice, 20);
  assert.deepEqual(input.priceTiers, [{ minQty: 3, price: 50 }]);
  assert.ok(!("bogus" in input), "unknown field must not be in returned input");
  passed++;
  console.log("PASS  returned input shape is clean");
}

// 10. Optional empty category/tiers omitted.
{
  const input = validateCreateProductInput({
    name: "Rice",
    unit: "kg",
    category: "",
    costPrice: 100,
    currentPrice: 120,
  });
  assert.equal(input.category, undefined, "empty category omitted");
  assert.equal(input.priceTiers, undefined, "absent tiers omitted");
  passed++;
  console.log("PASS  optional empty fields omitted");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
