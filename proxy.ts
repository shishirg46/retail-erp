// D9.8 — coarse network-boundary gate for the ERP API.
// Returns 401 for /api/* requests that carry no session cookie. This is NOT
// authoritative: every route handler performs its own DB-backed authentication
// and role check via lib/auth/authorize.ts. /api/auth/* (sign-in, sign-out,
// get-session) is excluded because signing in requires an unauthenticated call.

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["erp.session_token", "__Secure-erp.session_token"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!hasSessionCookie) {
    return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
