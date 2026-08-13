// F-03 unit tests for toHttpResponse (lib/response.ts) — Vitest.
//
// Pure mapping tests — no database access, so the development database is
// untouchable by construction. Proves:
//   - AppError subclasses keep their status code and client-safe message;
//   - any non-AppError failure maps to exactly `{ message: "Internal Server
//     Error" }` with status 500 and never leaks error.message / stack / Prisma
//     metadata / DB details;
//   - the original unexpected error is logged server-side via console.error.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../lib/errors";
import { toHttpResponse } from "../../lib/response";

function assertNoLeak(bodyText: string, canaries: string[]): void {
  const lower = bodyText.toLowerCase();
  for (const canary of canaries) {
    expect(lower.includes(canary.toLowerCase())).toBe(false);
  }
}

// Capture console.error so each 500 path can assert server-side logging
// without flooding the test output. Restored after the suite.
const realConsoleError = console.error;
let loggedErrors: unknown[] = [];

beforeAll(() => {
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };
});

afterAll(() => {
  console.error = realConsoleError;
});

beforeEach(() => {
  loggedErrors = [];
});

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

describe("toHttpResponse (F-03)", () => {
  it("ValidationError → 400 with preserved message, not logged", async () => {
    const res = toHttpResponse(new (class extends AppError {
      constructor() {
        super("name is required", 400);
      }
    })());
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.message).toBe("name is required");
    expect(loggedErrors.length).toBe(0);
  });

  it("BusinessRuleError → 400 with preserved message", async () => {
    const { BusinessRuleError } = await import("../../lib/errors");
    const res = toHttpResponse(new BusinessRuleError("sale must be a CREDIT sale"));
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.message).toBe("sale must be a CREDIT sale");
  });

  it("NotFoundError → 404 with preserved message", async () => {
    const { NotFoundError } = await import("../../lib/errors");
    const res = toHttpResponse(new NotFoundError("Product not found"));
    expect(res.status).toBe(404);
    const body = await jsonBody(res);
    expect(body.message).toBe("Product not found");
  });

  it("InsufficientStockError → 409 with preserved message", async () => {
    const { InsufficientStockError } = await import("../../lib/errors");
    const res = toHttpResponse(new InsufficientStockError("stock is 3, need 5"));
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.message).toBe("stock is 3, need 5");
  });

  it("ConflictError → 409 with preserved message", async () => {
    const { ConflictError } = await import("../../lib/errors");
    const res = toHttpResponse(new ConflictError("duplicate record"));
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.message).toBe("duplicate record");
  });

  it("raw Error → 500 generic, no message leak, logged", async () => {
    const res = toHttpResponse(
      new Error(
        "\nInvalid `this.db.product.findMany()` invocation in\n/home/elshishir/Documents/erp-retail/.next/dev/server/chunks/foo._.js:583:43\n\nCan't reach database server at 127.0.0.1:5432"
      )
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await jsonBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
    const serialized = JSON.stringify(body);
    assertNoLeak(serialized, LEAK_CANARIES);
    expect(loggedErrors.length).toBe(1);
    const logged = loggedErrors[0] as unknown[];
    expect(logged[0]).toBe("[unhandled-error]");
    expect(logged[1]).toBeInstanceOf(Error);
  });

  it("Prisma-style error object → 500 generic, no meta leak", async () => {
    const prismaLike = Object.assign(
      new Error("Unique constraint failed on the fields: (`name`)"),
      {
        code: "P2002",
        meta: { target: ["name"], modelName: "Product" },
        clientVersion: "7.9.0",
      }
    );
    const res = toHttpResponse(prismaLike);
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
    assertNoLeak(JSON.stringify(body), LEAK_CANARIES);
    expect(loggedErrors.length).toBe(1);
  });

  it("connection-string error → 500 generic, no DB details", async () => {
    const res = toHttpResponse(
      new Error(
        "Connection terminated due to timeout: postgresql://user:secret@127.0.0.1:5432/erp_retail_test"
      )
    );
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
    assertNoLeak(JSON.stringify(body), [
      "postgresql://",
      "user:secret",
      "127.0.0.1",
      "5432",
      "erp_retail_test",
      "Connection terminated",
    ]);
    expect(loggedErrors.length).toBe(1);
  });

  it("thrown string → 500 generic", async () => {
    const res = toHttpResponse("boom");
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
  });

  it("thrown null → 500 generic", async () => {
    const res = toHttpResponse(null);
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
  });

  it("thrown undefined → 500 generic", async () => {
    const res = toHttpResponse(undefined);
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual({ message: "Internal Server Error" });
  });
});