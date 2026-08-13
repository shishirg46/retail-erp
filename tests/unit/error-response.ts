// F-03 unit tests for toHttpResponse (lib/response.ts).
//
// Pure mapping tests — no database access, so the development database is
// untouchable by construction. Uses tsx + node:assert (no test framework).
// Proves:
//   - AppError subclasses keep their status code and client-safe message;
//   - any non-AppError failure maps to exactly `{ message: "Internal Server
//     Error" }` with status 500 and never leaks error.message / stack / Prisma
//     metadata / DB details;
//   - the original unexpected error is logged server-side via console.error.

import { strict as assert } from "node:assert";
import { AppError } from "../../lib/errors";
import { toHttpResponse } from "../../lib/response";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

function assertNoLeak(bodyText: string, canaries: string[]): void {
  const lower = bodyText.toLowerCase();
  for (const canary of canaries) {
    assert.ok(
      !lower.includes(canary.toLowerCase()),
      `body must not contain '${canary}'`
    );
  }
}

// Capture console.error so each 500 path can assert server-side logging
// without flooding the test output.
const realConsoleError = console.error;
let loggedErrors: unknown[] = [];
console.error = (...args: unknown[]) => {
  loggedErrors.push(args);
};

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const LEAK_CANARIES = [
  "Can't reach database",
  "Can't reach database server",
  "Unique constraint failed",
  "findMany",
  "products.name",
  ".next/",
  "/home/elshishir",
  "127.0.0.1",
  "5432",
  "postgresql://",
  "erp_retail",
  "at Object",
  "invocation in",
  "meta:",
  "stack",
];

// 1. AppError subclasses keep status + message.
test("ValidationError → 400 with preserved message", async () => {
  loggedErrors = [];
  const res = toHttpResponse(new (class extends AppError {
    constructor() {
      super("name is required", 400);
    }
  })());
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.message, "name is required");
  assert.equal(loggedErrors.length, 0, "AppError must not be logged as unhandled");
});

test("BusinessRuleError → 400 with preserved message", async () => {
  const { BusinessRuleError } = await import("../../lib/errors");
  const res = toHttpResponse(new BusinessRuleError("sale must be a CREDIT sale"));
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.message, "sale must be a CREDIT sale");
});

test("NotFoundError → 404 with preserved message", async () => {
  const { NotFoundError } = await import("../../lib/errors");
  const res = toHttpResponse(new NotFoundError("Product not found"));
  assert.equal(res.status, 404);
  const body = await jsonBody(res);
  assert.equal(body.message, "Product not found");
});

test("InsufficientStockError → 409 with preserved message", async () => {
  const { InsufficientStockError } = await import("../../lib/errors");
  const res = toHttpResponse(new InsufficientStockError("stock is 3, need 5"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.message, "stock is 3, need 5");
});

test("ConflictError → 409 with preserved message", async () => {
  const { ConflictError } = await import("../../lib/errors");
  const res = toHttpResponse(new ConflictError("duplicate record"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.message, "duplicate record");
});

// 2. Unexpected Error (driver/Prisma style) → sanitized 500.
test("raw Error → 500 generic, no message leak, logged", async () => {
  loggedErrors = [];
  const res = toHttpResponse(
    new Error(
      "\nInvalid `this.db.product.findMany()` invocation in\n/home/elshishir/Documents/erp-retail/.next/dev/server/chunks/foo._.js:583:43\n\nCan't reach database server at 127.0.0.1:5432"
    )
  );
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("content-type"), "application/json");
  const body = await jsonBody(res);
  assert.deepEqual(body, { message: "Internal Server Error" });
  const serialized = JSON.stringify(body);
  assertNoLeak(serialized, LEAK_CANARIES);
  assert.equal(loggedErrors.length, 1, "unexpected error must be logged");
  const logged = loggedErrors[0] as unknown[];
  assert.equal(logged[0], "[unhandled-error]");
  assert.ok(logged[1] instanceof Error);
});

test("Prisma-style error object → 500 generic, no meta leak", async () => {
  loggedErrors = [];
  const prismaLike = Object.assign(
    new Error("Unique constraint failed on the fields: (`name`)"),
    {
      code: "P2002",
      meta: { target: ["name"], modelName: "Product" },
      clientVersion: "7.9.0",
    }
  );
  const res = toHttpResponse(prismaLike);
  assert.equal(res.status, 500);
  const body = await jsonBody(res);
  assert.deepEqual(body, { message: "Internal Server Error" });
  assertNoLeak(JSON.stringify(body), LEAK_CANARIES);
  assert.equal(loggedErrors.length, 1, "unexpected error must be logged");
});

test("connection-string error → 500 generic, no DB details", async () => {
  loggedErrors = [];
  const res = toHttpResponse(
    new Error(
      "Connection terminated due to timeout: postgresql://user:secret@127.0.0.1:5432/erp_retail_test"
    )
  );
  assert.equal(res.status, 500);
  const body = await jsonBody(res);
  assert.deepEqual(body, { message: "Internal Server Error" });
  assertNoLeak(JSON.stringify(body), [
    "postgresql://",
    "user:secret",
    "127.0.0.1",
    "5432",
    "erp_retail_test",
    "Connection terminated",
  ]);
  assert.equal(loggedErrors.length, 1);
});

// 3. Non-Error thrown values → sanitized 500.
test("thrown string → 500 generic", async () => {
  const res = toHttpResponse("boom");
  assert.equal(res.status, 500);
  const body = await jsonBody(res);
  assert.deepEqual(body, { message: "Internal Server Error" });
});

test("thrown null → 500 generic", async () => {
  const res = toHttpResponse(null);
  assert.equal(res.status, 500);
  const body = await jsonBody(res);
  assert.deepEqual(body, { message: "Internal Server Error" });
});

test("thrown undefined → 500 generic", async () => {
  const res = toHttpResponse(undefined);
  assert.equal(res.status, 500);
  const body = await jsonBody(res);
  assert.deepEqual(body, { message: "Internal Server Error" });
});

console.error = realConsoleError;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
