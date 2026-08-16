// Server-side session access for RSC pages (D22.5). The workspace layout is
// the authoritative UI gate: it calls the DB-backed getSession and redirects
// unauthenticated users to /sign-in. Better Auth performs the lookup; the
// proxy's cookie-presence check is only a coarse fast-path (D9.8).

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import type { Role } from "@/lib/auth/authorize";

// The slice of the session the client shell needs (serializable, no secrets).
export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: Role;
}

export async function getSession(): Promise<{ user: SessionUser } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const { id, name, username, role } = session.user;
  return {
    user: {
      id,
      name: name ?? username ?? id,
      username: username ?? id,
      role: (role ?? "CASHIER") as Role,
    },
  };
}

// For pages that must exist only behind a valid session. Redirects to /sign-in.
export async function requireSession(): Promise<{ user: SessionUser }> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

// Owns-role guard for server-rendered pages. Redirects to / for forbidden roles
// (menus are already role-filtered client-side; this is the authoritative gate).
export async function requireRole(roles: readonly Role[]): Promise<{ user: SessionUser }> {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) redirect("/");
  return session;
}
