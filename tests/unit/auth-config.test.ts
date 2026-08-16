// F-10 unit coverage: Better Auth configuration surface and the pure parts of
// the application authorization helpers.
//
// DB-touching behavior (session lookup, role enforcement over HTTP) lives in
// tests/http/auth-flow.test.ts; here we pin the configuration constants that
// the implementation depends on (D9), the password-hash format, the core
// table set, and assertSameOrigin (D9.9), which is pure.

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { getAuthTables } from "better-auth/db";
import { hashPassword, verifyPassword } from "@better-auth/utils/password";

import { auth } from "../../lib/auth";
import { assertSameOrigin, CASHIER, OWNER, Role } from "../../lib/auth/authorize";
import { devLanTrustedOrigins } from "../../lib/auth/base-url";
import { ForbiddenError } from "../../lib/errors";

describe("F-10 auth config", () => {
  it("enables email+password with sign-up disabled and min 8 chars", () => {
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
    expect(auth.options.emailAndPassword?.minPasswordLength).toBe(8);
  });

  it("registers the username and admin plugins", () => {
    const plugins = auth.options.plugins;
    expect(plugins?.some((plugin) => plugin.id === "username")).toBe(true);
    expect(plugins?.some((plugin) => plugin.id === "admin")).toBe(true);
  });

  it("uses the erp cookie prefix with 12h sessions and a 6h sliding window", () => {
    expect(auth.options.advanced?.cookiePrefix).toBe("erp");
    expect(auth.options.session?.expiresIn).toBe(43200);
    expect(auth.options.session?.updateAge).toBe(21600);
  });

  it("owns exactly the four core Better Auth tables", () => {
    const tables = getAuthTables(auth.options);
    expect(Object.keys(tables).sort()).toEqual(["account", "session", "user", "verification"].sort());
  });
});

describe("F-10 password hashing", () => {
  it("round-trips a password (scrypt salt:key) and rejects a wrong one", async () => {
    const hashed = await hashPassword("correct horse 8+");
    expect(hashed).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    await expect(verifyPassword(hashed, "correct horse 8+")).resolves.toBe(true);
    await expect(verifyPassword(hashed, "wrong!")).resolves.toBe(false);
  });
});

describe("F-10 dev-only LAN trusted origin (Better Auth origin check)", () => {
  it("trusts the LAN dev host (port-wildcarded) in development only", () => {
    expect(devLanTrustedOrigins({ NODE_ENV: "development" })).toEqual(["http://192.168.1.123:*"]);
    expect(devLanTrustedOrigins({ NODE_ENV: "production" })).toEqual([]);
    expect(devLanTrustedOrigins({})).toEqual([]);
  });

  it("keeps the strict origin check in production", () => {
    const trusted = devLanTrustedOrigins({ NODE_ENV: "production" });
    expect(trusted).toHaveLength(0);
  });
});

describe("F-10 assertSameOrigin (D9.9)", () => {
  const base = "http://localhost:3000";

  it("ignores GET (non-state-changing)", () => {
    const req = new NextRequest(`${base}/api/users`, {
      method: "GET",
      headers: { origin: "http://evil.example" },
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("allows a state-changing request with no Origin header", () => {
    const req = new NextRequest(`${base}/api/users`, { method: "POST" });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("allows a state-changing request whose Origin matches the request host", () => {
    const req = new NextRequest(`${base}/api/users`, {
      method: "POST",
      headers: { origin: base },
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("rejects a state-changing request with a foreign Origin", () => {
    const req = new NextRequest(`${base}/api/users`, {
      method: "PATCH",
      headers: { origin: "http://evil.example" },
    });
    expect(() => assertSameOrigin(req)).toThrow(ForbiddenError);
    expect(() => assertSameOrigin(req)).toThrow("Cross-origin request rejected");
  });
});

// Keep the Role type referenced so the OWNER/CASHIER constants are exercised.
describe("F-10 role constants", () => {
  it("exposes OWNER and CASHIER", () => {
    const roles: readonly Role[] = [OWNER, CASHIER];
    expect(roles).toContain("OWNER");
    expect(roles).toContain("CASHIER");
  });
});
