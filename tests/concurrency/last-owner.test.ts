// P4 concurrency regression suite — last active OWNER invariant (D7).
//
// The D7 guard is read-then-write, and the write is performed by Better Auth
// in its own transaction, so Postgres row locks cannot span the check and the
// mutation. The fix is a process-local async mutex serializing guard + write.
//
// The realistic exploit is two OWNERs demoting each other concurrently: with
// two active OWNERs, each request observes count=2, both guards pass, and the
// system is left with zero active OWNERs. These scenarios reproduce exactly
// that interleaving and prove the invariant always holds afterwards.
//
// lib/auth.ts binds to process.env.DATABASE_URL, so this file repoints it at
// the guarded erp_retail_test database BEFORE importing the shared modules.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrisma, resolveTestDbUrl, truncateAll } from "../helpers/db";
import { createUserRecord } from "../helpers/auth";

process.env.DATABASE_URL = resolveTestDbUrl();

const { auth } = await import("../../lib/auth");
const { UserService } = await import("../../modules/users/user.service");

const prisma = createTestPrisma();
const userService = new UserService();

const OWNER_A = { username: "guard_owner_a", password: "ownera-pass-123", role: "OWNER" as const };
const OWNER_B = { username: "guard_owner_b", password: "ownerb-pass-123", role: "OWNER" as const };

// Sign in over better-auth's server API and build admin headers with the
// session cookie, exactly as a browser request would carry them.
async function sessionHeaders(username: string, password: string): Promise<Headers> {
  const res = await auth.api.signInEmail({
    asResponse: true,
    body: { email: `${username}@erp.local`, password },
  });
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.length > 0);
  if (cookies.length === 0) throw new Error("sign-in produced no session cookies");
  return new Headers({ cookie: cookies.join("; ") });
}

async function activeOwners(): Promise<number> {
  return prisma.user.count({ where: { role: "OWNER", banned: { not: true } } });
}

describe("P4 last-OWNER race", () => {
  let headersA: Headers;
  let headersB: Headers;

  beforeAll(async () => {
    await truncateAll(prisma);
    await createUserRecord(prisma, OWNER_A);
    await createUserRecord(prisma, OWNER_B);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await prisma.$disconnect();
  });

  // A and B each sign in fresh: truncateAll between scenarios invalidates
  // every session, so each scenario starts from a known 2-active-OWNER slate.
  beforeEach(async () => {
    await truncateAll(prisma);
    await createUserRecord(prisma, OWNER_A);
    await createUserRecord(prisma, OWNER_B);
    headersA = await sessionHeaders(OWNER_A.username, OWNER_A.password);
    headersB = await sessionHeaders(OWNER_B.username, OWNER_B.password);
    expect(await activeOwners()).toBe(2);
  });

  it("two cross-demotions leave exactly one active OWNER", async () => {
    const a = await prisma.user.findUnique({ where: { username: OWNER_A.username } });
    const b = await prisma.user.findUnique({ where: { username: OWNER_B.username } });

    const results = await Promise.allSettled([
      userService.updateRole(headersA, b!.id, { role: "CASHIER" }),
      userService.updateRole(headersB, a!.id, { role: "CASHIER" }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const err = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(err.length).toBe(1);
    expect(await activeOwners()).toBe(1);
  });

  it("two cross-bans leave exactly one active OWNER", async () => {
    const a = await prisma.user.findUnique({ where: { username: OWNER_A.username } });
    const b = await prisma.user.findUnique({ where: { username: OWNER_B.username } });

    const results = await Promise.allSettled([
      userService.banUser(headersA, b!.id),
      userService.banUser(headersB, a!.id),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const err = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(err.length).toBe(1);
    expect(await activeOwners()).toBe(1);
  });

  it("two cross-deletions leave exactly one active OWNER", async () => {
    const a = await prisma.user.findUnique({ where: { username: OWNER_A.username } });
    const b = await prisma.user.findUnique({ where: { username: OWNER_B.username } });

    const results = await Promise.allSettled([
      userService.deleteUser(headersA, b!.id),
      userService.deleteUser(headersB, a!.id),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(1);
    expect(await activeOwners()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });
});
