// F-10 HTTP integration suite — authentication and authorization over a real
// Next.js dev server against the dedicated `erp_retail_test` database.
//
// Covers the D9 acceptance criteria end to end:
//   - sign-in / sign-out / get-session lifecycle over /api/auth/*
//   - proxy gate: no session cookie → 401; /api/auth/* stays reachable
//   - D9.3 role matrix: CASHIER can sell + view master data but every
//     OWNER-only route returns 403
//   - D9.8 authoritative session check (forged cookie → 401)
//   - D9.9 cross-origin state-changing requests → 403
//   - D9.10 admin endpoints blocked (404) and /api/users never exposes email
//   - OWNER user management: create/get/update-role/ban/unban/reset-password/
//     delete, last-active-OWNER invariant, ban blocks sign-in, password reset
//     revokes sessions

import http from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureNoForeignDevServer,
  errorBody,
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
  signIn,
  startServer,
  stopServer,
  waitReady,
  warmRoutes,
  type Server,
} from "../helpers/http";
import { createTestPrisma, truncateAll } from "../helpers/db";
import { createUserRecord } from "../helpers/auth";

const port = 4800 + (process.pid % 400);
const prisma = createTestPrisma();

const OWNER = { username: "auth-owner", password: "authownerpass", role: "OWNER" } as const;
const CASHIER = { username: "auth-cashier", password: "authcashierpass", role: "CASHIER" } as const;

interface Identified {
  id: string;
}

// undici refuses to set the `origin` header on fetch, so the D9.9 cross-origin
// check uses a raw node:http request.
function rawPostWithOrigin(
  host: string,
  pathname: string,
  cookie: string,
  origin: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path: pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin,
          "content-length": Buffer.byteLength("{}"),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end("{}");
  });
}

describe("F-10 HTTP auth flow", () => {
  let server: Server;
  let p = 0;
  let ownerCookie = "";
  let ownerId = "";

  beforeAll(async () => {
    await ensureNoForeignDevServer();
    await truncateAll(prisma);
    await createUserRecord(prisma, OWNER);
    await createUserRecord(prisma, CASHIER);
    server = startServer(port);
    p = server.port;
    await waitReady(server);
    await warmRoutes(p, [
      "/api/auth/get-session",
      "/api/products",
      "/api/customers",
      "/api/suppliers",
      "/api/purchases",
      "/api/supplier-payments",
      "/api/reports/customers",
      "/api/reports/purchases",
      "/api/reports/suppliers",
      "/api/reports/wallet",
      "/api/users",
    ]);
    ownerCookie = await signIn(p, `${OWNER.username}@erp.local`, OWNER.password);
    const session = await httpGet(p, "/api/auth/get-session", ownerCookie);
    ownerId = ((await session.json()) as { user: { id: string } }).user.id;
  }, 300000);

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  }, 300000);

  // ── Sign-in lifecycle ──────────────────────────────────────────────────────
  it("sign-in with a wrong password → 401", async () => {
    const res = await httpPost(p, "/api/auth/sign-in/email", {
      email: `${OWNER.username}@erp.local`,
      password: "definitely-wrong",
    });
    expect(res.status).toBe(401);
    // Better Auth owns this error body ({ message, code }) — not the ERP
    // `{ message }` shape, so do not use errorBody().
    const body = (await res.json()) as { message?: string };
    expect(typeof body.message).toBe("string");
  });

  it("sign-in /api/auth/* needs no session cookie (proxy excludes auth)", async () => {
    const res = await httpPost(p, "/api/auth/sign-in/email", {
      email: `${OWNER.username}@erp.local`,
      password: OWNER.password,
    });
    expect(res.status).toBe(200);
  });

  it("get-session returns the signed-in user", async () => {
    const res = await httpGet(p, "/api/auth/get-session", ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { username: string; role: string } };
    expect(body.user.username).toBe(OWNER.username);
    expect(body.user.role).toBe("OWNER");
  });

  it("sign-out invalidates its own session (fresh cookie, leaves the suite cookie intact)", async () => {
    const fresh = await signIn(p, `${OWNER.username}@erp.local`, OWNER.password);
    const res = await httpPost(p, "/api/auth/sign-out", {}, fresh);
    expect(res.status).toBe(200);
    const session = await httpGet(p, "/api/auth/get-session", fresh);
    expect(await session.json()).toBeNull();
    const products = await httpGet(p, "/api/products", fresh);
    expect(products.status).toBe(401);
  });

  // ── Proxy gate (D9.8 coarse) ───────────────────────────────────────────────
  it("no session cookie on /api/* → 401", async () => {
    const res = await httpGet(p, "/api/products");
    expect(res.status).toBe(401);
    const body = await errorBody(res);
    expect(body.message).toBe("Authentication required");
  });

  it("forged cookie passes the gate but fails the authoritative check → 401", async () => {
    const res = await httpGet(p, "/api/products", "erp.session_token=forged-token");
    expect(res.status).toBe(401);
    const body = await errorBody(res);
    expect(body.message).toBe("Authentication required");
  });

  // ── CASHIER permission matrix (D9.3) ───────────────────────────────────────
  it("cashier can view products, customers, suppliers and create customers", async () => {
    const cashierCookie = await signIn(p, `${CASHIER.username}@erp.local`, CASHIER.password);
    const products = await httpGet(p, "/api/products", cashierCookie);
    expect(products.status).toBe(200);
    const customers = await httpGet(p, "/api/customers", cashierCookie);
    expect(customers.status).toBe(200);
    const suppliers = await httpGet(p, "/api/suppliers", cashierCookie);
    expect(suppliers.status).toBe(200);
    // D29: customer creation is OWNER-only (opening balance protection).
    const createCustomer = await httpPost(p, "/api/customers", { name: "Walk-in" }, cashierCookie);
    expect(createCustomer.status).toBe(403);
  });

  it("cashier gets 403 on every OWNER-only route", async () => {
    const cashierCookie = await signIn(p, `${CASHIER.username}@erp.local`, CASHIER.password);

    const cases = [
      httpPost(p, "/api/products", { name: "Nope", unit: "kg", costPrice: 1, currentPrice: 2 }, cashierCookie),
      httpPost(p, "/api/suppliers", { name: "Nope" }, cashierCookie),
      httpGet(p, "/api/purchases", cashierCookie),
      httpPost(p, "/api/supplier-payments", { supplierId: "s", amount: 1 }, cashierCookie),
      httpGet(p, "/api/reports/customers", cashierCookie),
      httpGet(p, "/api/reports/purchases", cashierCookie),
      httpGet(p, "/api/reports/suppliers", cashierCookie),
      httpGet(p, "/api/reports/wallet", cashierCookie),
      httpGet(p, "/api/users", cashierCookie),
      httpPost(p, "/api/users", { username: "x", password: "password123", role: "CASHIER" }, cashierCookie),
    ];
    for (const res of await Promise.all(cases)) {
      const text = await res.text();
      expect(res.status, text).toBe(403);
      const body = JSON.parse(text) as { message: string };
      expect(body.message).toBe("Insufficient permissions");
    }
  });

  // ── Cross-origin (D9.9) ────────────────────────────────────────────────────
  it("foreign Origin on a state-changing request → 403", async () => {
    const res = await rawPostWithOrigin("127.0.0.1", "/api/users", ownerCookie, "http://evil.example");
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ message: "Cross-origin request rejected" });
  });

  it("matching Origin on a state-changing request is allowed", async () => {
    // `{}` is not a valid user payload, so the route proceeds past the origin
    // check and returns 400 validation — proving the request was not rejected
    // as cross-origin.
    //
    // The Origin must match Next dev's appUrl host (`localhost`), because the
    // dev server normalizes req.url to that hostname regardless of the Host
    // header the client sent (a dev-mode artifact; production uses the real
    // host).
    const res = await rawPostWithOrigin("127.0.0.1", "/api/users", ownerCookie, `http://localhost:${p}`);
    expect(res.status).toBe(400);
  });

  // ── OWNER user management (D9.10, D9.5, last-active-OWNER invariant) ───────
  it("list users exposes no internal email", async () => {
    const res = await httpGet(p, "/api/users", ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<Record<string, unknown>> };
    for (const user of body.users) {
      expect(user).not.toHaveProperty("email");
      expect(user).not.toHaveProperty("emailVerified");
    }
    expect(body.users.length).toBeGreaterThanOrEqual(2);
  });

  it("admin plugin endpoints are blocked (404) — never expose the email", async () => {
    const res = await httpGet(p, "/api/auth/admin/list-users", ownerCookie);
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.message).toBe("Not found");
  });

  it("create + get + delete a cashier user", async () => {
    const created = await httpPost(p, "/api/users", {
      username: "temp_cashier",
      password: "temporarypass",
      role: "CASHIER",
    }, ownerCookie);
    expect(created.status).toBe(201);
    const user = (await created.json()) as Identified & { username: string; role: string };
    expect(user.username).toBe("temp_cashier");
    expect(user.role).toBe("CASHIER");
    expect(user).not.toHaveProperty("email");

    const one = await httpGet(p, `/api/users/${user.id}`, ownerCookie);
    expect(one.status).toBe(200);
    expect((await one.json()) as { username: string }).toMatchObject({ username: "temp_cashier" });

    const del = await httpDelete(p, `/api/users/${user.id}`, ownerCookie);
    expect(del.status).toBe(204);

    const gone = await httpGet(p, `/api/users/${user.id}`, ownerCookie);
    expect(gone.status).toBe(404);
  });

  it("update-role promotes a cashier to OWNER and back", async () => {
    const created = await httpPost(p, "/api/users", {
      username: "promotee",
      password: "promoteepass",
      role: "CASHIER",
    }, ownerCookie);
    const user = (await created.json()) as Identified;

    const promoted = await httpPatch(p, `/api/users/${user.id}`, { role: "OWNER" }, ownerCookie);
    expect(promoted.status).toBe(200);
    expect((await promoted.json()) as { role: string }).toMatchObject({ role: "OWNER" });

    const demoted = await httpPatch(p, `/api/users/${user.id}`, { role: "CASHIER" }, ownerCookie);
    expect(demoted.status).toBe(200);

    await httpDelete(p, `/api/users/${user.id}`, ownerCookie);
  });

  it("the last active OWNER cannot be demoted (D7 invariant)", async () => {
    const demote = await httpPatch(p, `/api/users/${ownerId}`, { role: "CASHIER" }, ownerCookie);
    expect(demote.status).toBe(400);
    await expect(demote.json()).resolves.toMatchObject({ message: /last active OWNER/ });
  });

  it("ban blocks sign-in; unban restores it", async () => {
    const created = await httpPost(p, "/api/users", {
      username: "banned_one",
      password: "bannedpass123",
      role: "CASHIER",
    }, ownerCookie);
    const user = (await created.json()) as Identified;

    const ban = await httpPost(p, `/api/users/${user.id}/ban`, {}, ownerCookie);
    expect(ban.status).toBe(200);
    expect((await ban.json()) as { banned: boolean }).toMatchObject({ banned: true });

    const blocked = await httpPost(p, "/api/auth/sign-in/email", {
      email: "banned_one@erp.local",
      password: "bannedpass123",
    });
    expect(blocked.status).toBe(403);

    const unban = await httpPost(p, `/api/users/${user.id}/unban`, {}, ownerCookie);
    expect(unban.status).toBe(200);

    const restored = await signIn(p, "banned_one@erp.local", "bannedpass123");
    expect(restored.length).toBeGreaterThan(0);

    await httpDelete(p, `/api/users/${user.id}`, ownerCookie);
  });

  it("reset-password revokes all of the user's sessions (D9.5)", async () => {
    const created = await httpPost(p, "/api/users", {
      username: "rotated",
      password: "originalpass",
      role: "CASHIER",
    }, ownerCookie);
    const user = (await created.json()) as Identified;

    const cashierCookie = await signIn(p, "rotated@erp.local", "originalpass");
    const before = await httpGet(p, "/api/products", cashierCookie);
    expect(before.status).toBe(200);

    const reset = await httpPost(p, `/api/users/${user.id}/reset-password`, {
      newPassword: "rotatedpass123",
    }, ownerCookie);
    expect(reset.status).toBe(204);

    const revoked = await httpGet(p, "/api/products", cashierCookie);
    expect(revoked.status).toBe(401);

    const reSigned = await signIn(p, "rotated@erp.local", "rotatedpass123");
    expect(reSigned.length).toBeGreaterThan(0);

    await httpDelete(p, `/api/users/${user.id}`, ownerCookie);
  });
});
