// Application-level authorization (D9.8, D9.9, F-10).
// Every ERP route handler calls one of these guards. Better Auth performs the
// DB-backed session lookup; these helpers convert the result into 401/403.

import type { NextRequest } from "next/server";

import { auth } from "../auth";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { prisma } from "../prisma";
import { consumeApiRequest } from "../rate-limit";
import { hasSessionCookie } from "./session-cookie";

export const OWNER = "OWNER" as const;
export const CASHIER = "CASHIER" as const;

export type Role = typeof OWNER | typeof CASHIER;

export type SessionContext = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// D9.9 — a present Origin header on a state-changing request must match the
// request's own origin; absent Origin (non-browser clients) is allowed.
export function assertSameOrigin(req: NextRequest): void {
  if (!STATE_CHANGING_METHODS.has(req.method)) return;

  const origin = req.headers.get("origin");
  if (!origin) return;

  const url = new URL(req.url);
  const requestOrigin = `${url.protocol}//${url.host}`;
  if (origin !== requestOrigin) {
    throw new ForbiddenError("Cross-origin request rejected");
  }
}

// D9.8 — authoritative DB-backed authentication. The proxy gate is only a
// coarse cookie-presence check; a forged/random cookie must fail here.
export async function requireUser(req: NextRequest): Promise<SessionContext> {
  // No session cookie at all -> 401 immediately, without touching the DB.
  // Only a present (possibly forged) cookie falls through to the DB-backed
  // session lookup, so a dead database with no cookie is a cheap 401 and with
  // a cookie surfaces as a sanitized 500 below.
  if (!hasSessionCookie(req)) {
    throw new UnauthorizedError();
  }

  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    // F-08: state-changing authenticated API requests are rate-limited per
    // user. Read requests are not limited.
    consumeApiRequest(session.user.id, req.method);
    return session;
  }

  // Better Auth swallows session-lookup errors into `null`, so a dead database
  // is indistinguishable from an invalid/expired token here. Probe the DB so an
  // unreachable database surfaces as a sanitized 500 (server fault) instead of
  // a misleading 401; only a genuinely invalid session becomes 401.
  await prisma.$queryRaw`SELECT 1`;

  throw new UnauthorizedError();
}

// Role authorization for the OWNER/CASHIER matrix (D9.3).
export async function requireRole(
  req: NextRequest,
  roles: readonly Role[],
): Promise<SessionContext> {
  assertSameOrigin(req);

  const session = await requireUser(req);
  const role = session.user.role;
  if (!role || !(roles as readonly string[]).includes(role)) {
    throw new ForbiddenError();
  }
  return session;
}
