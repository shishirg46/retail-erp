// Network boundary (D9.8) + UI-page nonce CSP (D21.1, D22).
//
// Two responsibilities, one proxy file (Next 16 allows a single proxy):
//
// 1. API gate (D9.8) — 401 for /api/* requests that carry no session cookie.
//    This is NOT authoritative: every route handler performs its own DB-backed
//    authentication via lib/auth/authorize.ts. /api/auth/* (sign-in, sign-out,
//    get-session) is excluded because signing in requires an unauthenticated
//    call.
//
// 2. UI-page CSP (D22) — every UI page ships a nonce-based Content-Security-
//    Policy. The nonce is also forwarded as the `x-nonce` request header so
//    Next.js attaches it to the scripts it renders (Next 16 CSP guide). Both
//    sign-in and the workspace pages are dynamically rendered (they read
//    headers for the session), so the nonce is applied at request time.
//
// The /api/* CSP is untouched: it stays the maximally strict
// `default-src 'none'` policy from next.config.ts. Static assets, prefetches,
// and image optimization are excluded below.
//
// style-src carries 'unsafe-inline' on purpose: Radix primitives position
// themselves with inline style attributes and Sonner injects a <style> element
// at runtime, neither of which can carry a nonce. Inline *scripts* remain
// strictly nonce-gated — that is the actual XSS vector.

import { NextResponse, type NextRequest } from "next/server";

import { hasSessionCookie } from "./lib/auth/session-cookie";

const isDev = process.env.NODE_ENV === "development";

function buildCspHeader(nonce: string): string {
  const connectSrc = `connect-src 'self'${isDev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    connectSrc,
    "frame-ancestors 'none'",
  ].join("; ");
}

function withUiPageCsp(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCspHeader(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/auth/")) return NextResponse.next();

    if (!hasSessionCookie(request)) {
      return NextResponse.json({ message: "Authentication required" }, { status: 401 });
    }

    return NextResponse.next();
  }

  return withUiPageCsp(request);
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|woff2?|map)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
