// P3 — route identifier format validation (lib/validate.ts).

import { describe, expect, it } from "vitest";
import { ValidationError } from "../../lib/errors";
import { assertUuid, assertUserId } from "../../lib/validate";

const UUID = "3f9a2b8c-4e5d-4f60-9a71-123456789abc";
const BA_ID = "ADoJzquwX4He1kjZV6bGss9LCnsycDXe";

describe("assertUuid", () => {
  it("accepts a valid UUID", () => {
    expect(() => assertUuid(UUID)).not.toThrow();
  });

  it("accepts any well-formed UUID string (including version-less keys)", () => {
    expect(() => assertUuid("00000000-0000-0000-0000-000000000000")).not.toThrow();
  });

  it("rejects non-UUID identifiers", () => {
    expect(() => assertUuid("not-a-uuid")).toThrow(ValidationError);
    expect(() => assertUuid(BA_ID)).toThrow(ValidationError);
    expect(() => assertUuid("")).toThrow(ValidationError);
  });

  it("names the offending field", () => {
    try {
      assertUuid("nope", "saleId");
      expect.unreachable();
    } catch (error) {
      const e = error as ValidationError;
      expect(e.statusCode).toBe(400);
      expect(e.message).toContain("saleId");
    }
  });
});

describe("assertUserId", () => {
  it("accepts a UUID user id", () => {
    expect(() => assertUserId(UUID)).not.toThrow();
  });

  it("accepts a Better Auth generateId(32) user id", () => {
    expect(() => assertUserId(BA_ID)).not.toThrow();
  });

  it("rejects malformed user ids", () => {
    expect(() => assertUserId("short")).toThrow(ValidationError);
    expect(() => assertUserId("1234567890123456789012345678901")).toThrow(ValidationError);
    expect(() => assertUserId("!@#$%^&*()12345678901234567890")).toThrow(ValidationError);
  });
});
