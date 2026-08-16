// Proxy unit coverage: the network-boundary guard that keeps sign-in
// credentials out of GET URLs (M21 LAN test, 16 Aug 2026).
//
// The sign-in form submits via POST (method="post"), so pages served by the
// app never leak credentials into a URL. This guard is defense-in-depth for
// stale pre-hydration clients / history re-fires that still send
// `GET /sign-in?username=…&password=…`: it 307s them to the clean URL so
// credentials are never processed through a GET. Better Auth, D9.9, and CSP
// are untouched — the guard runs before any /api/* handling.

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "../../proxy";

const BASE = "http://localhost:3000";

describe("proxy sign-in credential-leak guard", () => {
  it("307-redirects GET /sign-in carrying username/password to the clean URL", () => {
    const req = new NextRequest(`${BASE}/sign-in?username=liladhar&password=ghimire%40123`, {
      method: "GET",
    });
    const res = proxy(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") as string;
    expect(new URL(location, BASE).pathname).toBe("/sign-in");
    expect(new URL(location, BASE).search).toBe("");
  });

  it("passes through a clean GET /sign-in", () => {
    const req = new NextRequest(`${BASE}/sign-in`, { method: "GET" });
    const res = proxy(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
  });

  it("passes through GET /sign-in with unrelated query params", () => {
    const req = new NextRequest(`${BASE}/sign-in?foo=bar`, { method: "GET" });
    const res = proxy(req);
    expect(res.status).toBe(200);
  });

  it("passes through a POST /sign-in (native fallback submits in the body)", () => {
    const req = new NextRequest(`${BASE}/sign-in`, { method: "POST" });
    const res = proxy(req);
    expect(res.status).toBe(200);
  });
});
