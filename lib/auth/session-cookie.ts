// Shared session cookie contract (D9.8). The proxy gate and the route-level
// requireUser guard must agree on which cookies prove a session might exist.

import type { NextRequest } from "next/server";

// Better Auth cookie names with prefix "erp" (lib/auth.ts): the plain name in
// development (http) and the __Secure- variant in production (https).
export const SESSION_COOKIES = ["erp.session_token", "__Secure-erp.session_token"];

export function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => req.cookies.has(name));
}
