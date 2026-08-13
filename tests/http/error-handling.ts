// F-03 HTTP integration suite (leak prevention on unexpected 500s).
//
// Spawns a real Next.js dev server against the dedicated `erp_retail_test`
// database and verifies over real HTTP:
//   Phase 1 — expected application errors keep their status + message
//             (400 malformed/invalid JSON, 400 validation, 404 not-found,
//             409 insufficient stock).
//   Phase 2 — an unreachable database produces a sanitized 500 whose body is
//             exactly `{ "message": "Internal Server Error" }` and contains no
//             driver text, filesystem paths, DB names, hosts, ports, Prisma
//             invocation details, or connection details.
//
// Refuses to start unless TEST_DATABASE_URL points at `erp_retail_test`, so the
// development database can never be connected to by the test servers. Uses
// tsx + node:assert (no test framework).

import "dotenv/config";
import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const rawUrl = process.env.TEST_DATABASE_URL;

if (!rawUrl) {
  console.error(
    "TEST_DATABASE_URL is not set — refusing to run. Set it to the dedicated erp_retail_test database."
  );
  process.exit(1);
}

const testUrl = rawUrl.replace(/^"|"$/g, "");
const parsed = new URL(testUrl);
const dbName = parsed.pathname.replace(/^\//, "").split("?")[0];

if (dbName !== "erp_retail_test") {
  console.error(
    `TEST_DATABASE_URL must point at erp_retail_test (got '${dbName}') — refusing to run against any other database.`
  );
  process.exit(1);
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NEXT_BIN = path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next");
const BAD_DATABASE_URL = "postgresql://bad:secret@127.0.0.1:1/erp_retail_test";

const BASE_PORT = 4500 + (process.pid % 400);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testUrl }),
});

let passed = 0;
let failed = 0;

const LEAK_CANARIES = [
  "Can't reach database",
  "Can't reach database server",
  "Invalid `this.db",
  "Unique constraint failed",
  "findMany",
  "invocation in",
  ".next/",
  "/home/elshishir",
  "127.0.0.1",
  "5432",
  ":1",
  "postgresql://",
  "user:secret",
  "erp_retail",
  "developer connection",
  "at Object",
  "meta:",
  "stack",
  "node:internal",
];

function assertNoLeak(bodyText: string): void {
  const lower = bodyText.toLowerCase();
  for (const canary of LEAK_CANARIES) {
    assert.ok(
      !lower.includes(canary.toLowerCase()),
      `500 body must not leak '${canary}' (got: ${bodyText.slice(0, 200)})`
    );
  }
}

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      wallet_transactions,
      credit_payments,
      sale_items,
      sales,
      stock_movements,
      purchase_items,
      purchases,
      price_tiers,
      products,
      supplier_payments,
      suppliers,
      customers
    CASCADE
  `);
}

interface Server {
  child: ChildProcess;
  port: number;
  exited: { code: number | null; signal: NodeJS.Signals | null } | null;
}

const LOCK_PATH = path.join(REPO_ROOT, ".next", "dev", "lock");

interface DevLock {
  pid: number;
  port: number;
  hostname: string;
  appUrl: string;
  startedAt: number;
}

const activeServers: Server[] = [];

process.on("exit", () => {
  for (const server of activeServers) {
    try {
      process.kill(-(server.child.pid as number), "SIGKILL");
    } catch {
      // already gone
    }
  }
});

// Next 16 dev writes `.next/dev/lock` and refuses a second dev server in the
// same project directory. A foreign (developer's) dev server would therefore
// block the suite and must be surfaced clearly instead of silently timeouting.
async function ensureNoForeignDevServer(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await readFile(LOCK_PATH, "utf8");
  } catch {
    return; // no lock — nothing running
  }
  if (!raw) return;

  let lock: DevLock;
  try {
    lock = JSON.parse(raw) as DevLock;
  } catch {
    return;
  }
  if (typeof lock.pid !== "number") return;

  let alive = true;
  try {
    process.kill(lock.pid, 0);
  } catch {
    alive = false;
  }

  if (alive) {
    console.error(
      `A Next dev server is already running for this project ` +
        `(pid ${lock.pid}, ${lock.appUrl}). Stop it before running the F-03 HTTP ` +
        `suite — two dev servers cannot share .next/dev.`
    );
    process.exit(1);
  }

  try {
    await unlink(LOCK_PATH); // stale lock from a killed server
  } catch {
    // best-effort
  }
}

function startServer(port: number, databaseUrl: string): Server {
  const child = spawn(
    process.execPath,
    [NEXT_BIN, "dev", "-p", String(port)],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "development",
        NEXT_TELEMETRY_DISABLED: "1",
        PORT: String(port),
      },
    }
  );

  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});

  const server: Server = { child, port, exited: null };
  child.on("exit", (code, signal) => {
    server.exited = { code, signal };
  });
  activeServers.push(server);
  return server;
}

async function stopServer(server: Server): Promise<void> {
  const { child } = server;
  const group = -(child.pid as number);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(group, "SIGTERM");
    } catch {
      // already gone
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  try {
    process.kill(group, "SIGKILL");
  } catch {
    // already gone
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    const raw = await readFile(LOCK_PATH, "utf8");
    const lock = JSON.parse(raw) as DevLock;
    if (typeof lock.pid === "number") {
      let alive = true;
      try {
        process.kill(lock.pid, 0);
      } catch {
        alive = false;
      }
      if (!alive) await unlink(LOCK_PATH);
    }
  } catch {
    // no lock file — Next removed it on graceful shutdown
  }

  const index = activeServers.indexOf(server);
  if (index >= 0) activeServers.splice(index, 1);
}

async function waitReady(server: Server, timeoutMs = 180000): Promise<void> {
  const port = server.port;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exited !== null) {
      throw new Error(
        `Next dev server (pid ${server.child.pid}) exited early ` +
          `code=${server.exited.code} signal=${server.exited.signal}`
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/products`, {
        signal: AbortSignal.timeout(20000),
      });
      if (res.status > 0) return;
    } catch {
      // not ready yet — retry
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Next dev server on port ${port} did not become ready in ${timeoutMs}ms`);
}

async function httpGet(port: number, urlPath: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, {
    signal: AbortSignal.timeout(60000),
  });
}

async function httpPost(
  port: number,
  urlPath: string,
  body: unknown,
  contentType = "application/json"
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "content-type": contentType },
    body: contentType === "application/json" ? JSON.stringify(body) : String(body),
  });
}

// POST a raw text body unchanged (no JSON.stringify) — used to send genuinely
// malformed JSON so the route's `req.json()` path is exercised.
async function httpPostRaw(port: number, urlPath: string, rawText: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "content-type": "application/json" },
    body: rawText,
  });
}

async function errorBody(res: Response): Promise<{ message: string }> {
  const data = (await res.json()) as { message?: unknown };
  assert.equal(typeof data.message, "string", "error body must have a string message");
  assert.equal(Object.keys(data).length, 1, "error body must contain only `message`");
  return data as { message: string };
}

// ── Phase 1: expected application errors keep status + message ──────────────
async function phase1(): Promise<void> {
  const server = startServer(BASE_PORT, testUrl);
  const port = server.port;
  let productId = "";

  try {
    await waitReady(server);

await test("P1 malformed JSON body → 400", async () => {
    const res = await httpPostRaw(port, "/api/products", "not-json");
    assert.equal(res.status, 400);
    const body = await errorBody(res);
    assert.equal(body.message, "Invalid JSON body");
  });

  await test("P1 invalid product payload → 400 validation", async () => {
    const res = await httpPost(port, "/api/products", {
      name: "Rice",
      unit: "kg",
      costPrice: 100,
      currentPrice: -5,
    });
    assert.equal(res.status, 400);
    const body = await errorBody(res);
    assert.match(body.message, /currentPrice/i);
  });

  await test("P1 CREDIT sale without customerId → 400", async () => {
    const res = await httpPost(port, "/api/sales", {
      paymentType: "CREDIT",
      items: [],
    });
    assert.equal(res.status, 400);
    const body = await errorBody(res);
    assert.ok(body.message.length > 0);
  });

  await test("P1 valid product → 201 (seed)", async () => {
    const res = await httpPost(port, "/api/products", {
      name: "F03 Test Product",
      unit: "kg",
      costPrice: 100,
      currentPrice: 120,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string; stockQty: number };
    productId = body.id;
    assert.equal(body.stockQty, 0);
  });

  await test("P1 GET unknown product id → 404", async () => {
    const res = await httpGet(
      port,
      "/api/products/00000000-0000-0000-0000-000000000000"
    );
    assert.equal(res.status, 404);
    const body = await errorBody(res);
    assert.equal(body.message, "Product not found");
  });

  await test("P1 GET unknown sale id → 404", async () => {
    const res = await httpGet(
      port,
      "/api/sales/00000000-0000-0000-0000-000000000000"
    );
    assert.equal(res.status, 404);
    const body = await errorBody(res);
    assert.equal(body.message, "Sale not found");
  });

  await test("P1 DAMAGE above stock → 409", async () => {
    const seed = await httpPost(port, "/api/stock/adjustments", {
      productId,
      reason: "CORRECTION",
      quantity: 3,
      note: "seed",
    });
    assert.equal(seed.status, 201, "CORRECTION seed should succeed");

    const res = await httpPost(port, "/api/stock/adjustments", {
      productId,
      reason: "DAMAGE",
      quantity: 5,
      note: "above stock",
    });
    assert.equal(res.status, 409);
    const body = await errorBody(res);
    assert.match(body.message, /stock/i);
  });

  await test("P1 valid GET /api/products → 200 (sanity)", async () => {
    const res = await httpGet(port, "/api/products");
    assert.equal(res.status, 200);
    const data = (await res.json()) as unknown[];
    assert.ok(Array.isArray(data), "products list is an array");
  });
  } finally {
    await stopServer(server);
  }
}

// ── Phase 2: unreachable DB → sanitized 500 over real HTTP ──────────────────
async function phase2(): Promise<void> {
  const server = startServer(BASE_PORT + 1, BAD_DATABASE_URL);
  const port = server.port;

  try {
    await waitReady(server);

    await test("P2 GET /api/products → 500 exactly {message:\"Internal Server Error\"}", async () => {
      const res = await httpGet(port, "/api/products");
      assert.equal(res.status, 500);
      const body = await errorBody(res);
      assert.deepEqual(body, { message: "Internal Server Error" });
      assertNoLeak(JSON.stringify(body));
    });

    await test("P2 POST /api/products (valid payload) → 500 sanitized on write path", async () => {
      const res = await httpPost(port, "/api/products", {
        name: "Leak",
        unit: "pcs",
        costPrice: 1,
        currentPrice: 2,
      });
      assert.equal(res.status, 500);
      const body = await errorBody(res);
      assert.deepEqual(body, { message: "Internal Server Error" });
      assertNoLeak(JSON.stringify(body));
    });

    await test("P2 GET /api/sales → 500 sanitized on another route", async () => {
      const res = await httpGet(port, "/api/sales");
      assert.equal(res.status, 500);
      const body = await errorBody(res);
      assert.deepEqual(body, { message: "Internal Server Error" });
      assertNoLeak(JSON.stringify(body));
    });

    await test("P2 report route → 500 sanitized", async () => {
      const res = await httpGet(port, "/api/reports/sales");
      assert.equal(res.status, 500);
      const body = await errorBody(res);
      assert.deepEqual(body, { message: "Internal Server Error" });
      assertNoLeak(JSON.stringify(body));
    });
  } finally {
    await stopServer(server);
  }
}

async function main(): Promise<void> {
  try {
    await ensureNoForeignDevServer();
    await resetDatabase();
    await phase1();

    await resetDatabase();

    await phase2();
  } catch (error) {
    failed++;
    console.error("HARNESS FAIL");
    console.error(error);
  } finally {
    await resetDatabase();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();