// Auth fixtures for suites that exercise the F-10 authentication layer.
//
// Users are inserted directly into the dedicated `erp_retail_test` database
// using Better Auth's own scrypt hash (@better-auth/utils/password), so the
// resulting credential verifies at sign-in over real HTTP. The seed mirrors
// scripts/seed-owner.mjs: name = username, email = <username>@erp.local
// (D9.10 internal email), provider "credential".

import { hashPassword } from "@better-auth/utils/password";

import type { PrismaClient } from "../../generated/prisma/client";

export interface SeedUserOptions {
  username: string;
  password: string;
  role: "OWNER" | "CASHIER";
}

export async function createUserRecord(
  prisma: PrismaClient,
  options: SeedUserOptions,
): Promise<{ id: string }> {
  const hash = await hashPassword(options.password);
  const id = crypto.randomUUID();
  const now = new Date();

  const user = await prisma.user.create({
    data: {
      id,
      name: options.username,
      email: `${options.username}@erp.local`,
      emailVerified: true,
      username: options.username,
      role: options.role,
      banned: false,
      createdAt: now,
      updatedAt: now,
      accounts: {
        create: {
          id: crypto.randomUUID(),
          accountId: id,
          providerId: "credential",
          password: hash,
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  });

  return { id: user.id };
}
