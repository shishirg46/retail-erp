// Role constants (D9.3). Kept in a dependency-free module so client components
// (nav model, D21.7) can import them without pulling in the Prisma/pg graph
// that lib/auth/authorize.ts needs for DB-backed session checks.

export const OWNER = "OWNER" as const;
export const CASHIER = "CASHIER" as const;

export type Role = typeof OWNER | typeof CASHIER;
