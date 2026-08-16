import { describe, expect, it } from "vitest";

import { signInSchema } from "@/lib/validate/sign-in";

describe("signInSchema", () => {
  it("accepts a valid username + password", () => {
    const result = signInSchema.safeParse({ username: "ram", password: "secret123" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty username", () => {
    const result = signInSchema.safeParse({ username: "  ", password: "secret123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/username/i);
    }
  });

  it("rejects a short password (mirrors lib/auth.ts min 8)", () => {
    const result = signInSchema.safeParse({ username: "ram", password: "short" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/8 characters/i);
    }
  });
});
