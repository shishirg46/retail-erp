// Central Better Auth configuration (D9, F-10).
// Better Auth owns authentication: password hashing/verification, DB-backed
// sessions, cookies, login/logout, and user administration. Application-level
// authorization for the OWNER/CASHIER matrix is enforced in lib/auth/authorize.ts.

import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { admin, createAccessControl, username } from "better-auth/plugins";
import { prisma } from "./prisma";
import { resolveAuthBaseURL } from "./auth/base-url";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  throw new Error(
    "BETTER_AUTH_SECRET is missing. Set it in .env (npx auth secret or openssl rand -base64 32).",
  );
}

// Access-control statements for the admin plugin. These gate Better Auth's own
// /api/auth/admin/* endpoints; our ERP routes use the role guards in
// lib/auth/authorize.ts instead.
const ac = createAccessControl({
  user: ["create", "list", "get", "update", "set-role", "ban", "delete", "set-password"],
  session: ["list", "revoke", "delete"],
});

const ownerRole = ac.newRole({
  user: ["create", "list", "get", "update", "set-role", "ban", "delete", "set-password"],
  session: ["list", "revoke", "delete"],
});

const cashierRole = ac.newRole({ user: [], session: [] });

export const auth = betterAuth({
  baseURL: resolveAuthBaseURL(),
  secret,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
  },
  plugins: [
    username(),
    admin({
      defaultRole: "CASHIER",
      adminRoles: ["OWNER"],
      roles: { OWNER: ownerRole, CASHIER: cashierRole },
    }),
  ],
  session: {
    expiresIn: 43200, // 12h
    updateAge: 21600, // sliding window: refresh every 6h of activity
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "erp",
  },
});
