// F-11 HTTP suite — security headers and CORS policy over a real dev server.
//
// next.config.ts emits baseline headers on every response and a strict CSP on
// the JSON API. CORS is deliberately disabled: no Access-Control-Allow-* header
// may ever be emitted, so browsers enforce same-origin for reads and writes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureNoForeignDevServer,
  httpGet,
  startServer,
  stopServer,
  waitReady,
  warmRoutes,
  type Server,
} from "../helpers/http";
import { createTestPrisma, truncateAll } from "../helpers/db";

const port = 5200 + (process.pid % 400);
const prisma = createTestPrisma();

const BASELINE: [string, string][] = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-frame-options", "DENY"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()"],
];

function headers(res: Response): Map<string, string> {
  const map = new Map<string, string>();
  res.headers.forEach((value, key) => map.set(key.toLowerCase(), value));
  return map;
}

function assertNoCors(res: Response): void {
  const hs = headers(res);
  for (const [key] of hs) {
    expect(key.startsWith("access-control")).toBe(false);
  }
}

describe("security headers over HTTP (F-11)", () => {
  let server: Server;
  let p = 0;

  beforeAll(async () => {
    ensureNoForeignDevServer();
    await truncateAll(prisma);
    server = await startServer(port, process.env.TEST_DATABASE_URL);
    await waitReady(server);
    await warmRoutes(port, []);
    p = port;
  });

  afterAll(async () => {
    await stopServer(server);
    await truncateAll(prisma);
    await prisma.$disconnect();
  });

  it("applies baseline headers to the scaffold page and never emits CORS headers", async () => {
    const res = await fetch(`http://127.0.0.1:${p}/`, {
      signal: AbortSignal.timeout(60000),
    });
    expect(res.status).toBe(200);
    const hs = headers(res);
    for (const [key, value] of BASELINE) {
      expect(hs.get(key)).toBe(value);
    }
    assertNoCors(res);
  });

  it("applies baseline + strict CSP to API proxy responses and never emits CORS headers", async () => {
    const res = await httpGet(p, "/api/products");
    expect(res.status).toBe(401);
    const hs = headers(res);
    for (const [key, value] of BASELINE) {
      expect(hs.get(key)).toBe(value);
    }
    expect(hs.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    expect(hs.get("cross-origin-resource-policy")).toBe("same-origin");
    assertNoCors(res);
  });

  it("applies the strict CSP to better-auth endpoints", async () => {
    const res = await fetch(`http://127.0.0.1:${p}/api/auth/get-session`, {
      signal: AbortSignal.timeout(60000),
    });
    expect(res.status).toBe(200);
    const hs = headers(res);
    expect(hs.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    assertNoCors(res);
  });
});
