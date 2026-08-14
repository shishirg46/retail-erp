// Application-level authorization (D9.8, D9.9, F-10).
// Every ERP route handler calls one of these guards. Better Auth performs the
// DB-backed session lookup; these helpers convert the result into 401/403.

import type { NextRequest } from "next/server";

import { auth } from "../auth";
import { ForbiddenError, UnauthorizedError } from "../errors";

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
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) throw new UnauthorizedError();
  return session;
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
