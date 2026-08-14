import type { RawUser, UserAdminView } from "./user.types";

// Better Auth records carry the internal derived email (<username>@erp.local).
// D9.10: that email is never exposed through ERP responses — the username is
// the user-facing identifier.
export function toUserAdminView(raw: RawUser): UserAdminView {
  return {
    id: raw.id,
    username: raw.username ?? null,
    role: raw.role ?? null,
    banned: Boolean(raw.banned),
    banReason: raw.banReason ?? null,
    banExpires: raw.banExpires ?? null,
    createdAt: raw.createdAt,
  };
}
