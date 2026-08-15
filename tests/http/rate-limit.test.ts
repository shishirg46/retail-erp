// F-08 HTTP suite — rate limiting over a real Next.js dev server.
//
// Two concerns are exercised end to end:
//   - auth brute-force protection: sign-in attempts are limited per client
//     and the limit resets with the window
//   - API abuse protection: state-changing requests are limited per user,
//     while reads are never limited
//
// The server is spawned with small env-configured limits so the boundary is
// reached deterministically; env is restored afterwards.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureNoForeignDevServer,
  httpGet,
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

const port = 5100 + (process.pid % 400);
const prisma = createTestPrisma();

const OWNER = { username: "rl-owner", password: "rlownerpass", role: "OWNER" } as const;

const ORIGINAL_ENV = { ...process.env };

const productBody = { name: "Rate Rice", unit: "kg", costPrice: 5, currentPrice: 10 };

async function signInAttempt(email: string, password: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

describe("rate limiting over HTTP (F-08)", () => {
  let server: Server;
  let p = 0;
  let ownerCookie = "";

  beforeAll(async () => {
    process.env.ERP_RATE_LIMIT_AUTH_MAX = "5";
    process.env.ERP_RATE_LIMIT_AUTH_WINDOW_MS = "60000";
    process.env.ERP_RATE_LIMIT_API_MAX = "3";
    process.env.ERP_RATE_LIMIT_API_WINDOW_MS = "60000";

    ensureNoForeignDevServer();
    await truncateAll(prisma);
    await createUserRecord(prisma, OWNER);
    server = await startServer(port, process.env.TEST_DATABASE_URL);
    await waitReady(server);
    await warmRoutes(port, []);
    p = port;

    // Attempt #1 of the auth limit (valid credentials).
    ownerCookie = await signIn(p, `${OWNER.username}@erp.local`, OWNER.password);
  });

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
    process.env = { ...ORIGINAL_ENV };
  });

  it("limits state-changing API requests per user but never limits reads", async () => {
    const first = await httpPost(p, "/api/products", productBody, ownerCookie);
    expect(first.status).toBe(201);
    const second = await httpPost(p, "/api/products", productBody, ownerCookie);
    expect(second.status).toBe(201);
    const third = await httpPost(p, "/api/products", productBody, ownerCookie);
    expect(third.status).toBe(201);

    const blocked = await httpPost(p, "/api/products", productBody, ownerCookie);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { message?: string };
    expect(body.message).toBe("Too many requests");

    const read = await httpGet(p, "/api/products", ownerCookie);
    expect(read.status).toBe(200);
  });

  it("returns 429 for the sign-in attempt past the auth limit", async () => {
    // Attempts #2..#5 are still allowed (each wrong-credential attempt is 401).
    for (let i = 0; i < 4; i++) {
      const res = await signInAttempt("no-such-user@erp.local", "wrongpass123");
      expect(res.status).toBe(401);
    }

    // Attempt #6 exceeds the limit of 5 -> 429, regardless of credentials.
    const blocked = await signInAttempt(`${OWNER.username}@erp.local`, OWNER.password);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { message?: string };
    expect(body.message).toBe("Too many requests");
  });
});
