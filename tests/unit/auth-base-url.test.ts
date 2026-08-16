// F-10 unit coverage: Better Auth base URL resolution for Vercel previews.
//
// resolveAuthBaseURL is the pure decision behind the baseURL option in
// lib/auth.ts. It must keep local development on http://localhost, accept an
// explicit BETTER_AUTH_URL, and never hardcode a single Vercel preview host.

import { describe, expect, it } from "vitest";

import {
  DYNAMIC_ALLOWED_HOSTS,
  LOCAL_FALLBACK_URL,
  resolveAuthBaseURL,
} from "../../lib/auth/base-url";

describe("F-10 resolveAuthBaseURL (Vercel preview support)", () => {
  it("returns an explicit BETTER_AUTH_URL unchanged", () => {
    const cfg = resolveAuthBaseURL({ BETTER_AUTH_URL: "https://erp.example.com" });
    expect(cfg).toBe("https://erp.example.com");
  });

  it("defaults to a dynamic config covering localhost and Vercel previews", () => {
    const cfg = resolveAuthBaseURL({});
    expect(cfg).toEqual({
      protocol: "auto",
      allowedHosts: ["localhost", "127.0.0.1", "*.vercel.app"],
      fallback: "http://localhost:3000",
    });
  });

  it("keeps local development on the loopback fallback", () => {
    const cfg = resolveAuthBaseURL({});
    expect(cfg).toMatchObject({
      protocol: "auto",
      fallback: LOCAL_FALLBACK_URL,
    });
    expect(DYNAMIC_ALLOWED_HOSTS).toContain("localhost");
  });

  it("never resolves to a single hardcoded preview host", () => {
    const cfg = resolveAuthBaseURL({ VERCEL_URL: "erp-retail-git-demo-123.vercel.app" });
    expect(typeof cfg).toBe("object");
    expect(cfg).toMatchObject({ protocol: "auto" });
    if (typeof cfg !== "string") {
      expect(cfg.allowedHosts).toContain("*.vercel.app");
    }
  });
});
