// F-04 HTTP integration suite (input upper bounds).
//
// Spawns a real Next.js dev server against the dedicated `erp_retail_test`
// database and verifies over real HTTP that over-limit numeric inputs are
// rejected with 400 at the request boundary (ValidationError) — never a 500,
// never a crash — while boundary-maximum values still succeed.
//
// The key acceptance criterion: the documented F-04 DoS payload
// (`items[0].quantity: 1e8`, which previously drove calculatePrice's
// `new Array(qty + 1)` ~800 MB allocation) must now return 400 immediately,
// proving validation rejects it before calculatePrice is ever reached.
//
// Refuses to start unless TEST_DATABASE_URL points at `erp_retail_test`, so the
// development database can never be connected to by the test server. Uses
// tsx + node:assert (no test framework).

import "dotenv/config";
import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import {
  MAX_AMOUNT,
  MAX_ITEM_QUANTITY,
  MAX_ITEMS_PER_DOCUMENT,
} from "../../lib/bounds";

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
const PORT = 4600 + (process.pid % 400);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testUrl }),
});

let passed = 0;
let failed = 0;

interface Server {
  child: ChildProcess;
  port: number;
  exited: { code: number | null; signal: NodeJS.Signals | null } | null;
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

async function test(
  name: string,
  fn: () => Promise<void> | void
): Promise<void> {
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

const LOCK_PATH = path.join(REPO_ROOT, ".next", "dev", "lock");

interface DevLock {
  pid: number;
  port: number;
  hostname: string;
  appUrl: string;
  startedAt: number;
}

async function ensureNoForeignDevServer(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await readFile(LOCK_PATH, "utf8");
  } catch {
    return;
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
        `(pid ${lock.pid}, ${lock.appUrl}). Stop it before running the F-04 HTTP ` +
        `suite — two dev servers cannot share .next/dev.`
    );
    process.exit(1);
  }

  try {
    await unlink(LOCK_PATH);
  } catch {
    // best-effort
  }
}

function startServer(port: number): Server {
  const child = spawn(
    process.execPath,
    [NEXT_BIN, "dev", "-p", String(port)],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
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
    // no lock file
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
      // retry
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

async function httpPost(port: number, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorBody(res: Response): Promise<{ message: string }> {
  const data = (await res.json()) as { message?: unknown };
  assert.equal(typeof data.message, "string", "error body must have a string message");
  assert.equal(Object.keys(data).length, 1, "error body must contain only `message`");
  return data as { message: string };
}

const itemsOfLength = (n: number) =>
  Array.from({ length: n }, () => ({ productId: "p-seed", quantity: 1 }));

async function main(): Promise<void> {
  const server = startServer(PORT);
  let seededProductId = "";

  try {
    await ensureNoForeignDevServer();
    await resetDatabase();
    await waitReady(server);
    const port = server.port;

    // ── Over-limit rejection (400, no crash, no allocate) ───────────────────
    await test("sale: documented F-04 DoS payload quantity=1e8 → 400", async () => {
      const started = Date.now();
      const res = await httpPost(port, "/api/sales", {
        paymentType: "CASH",
        items: [{ productId: "p-seed", quantity: 100000000 }],
      });
      assert.equal(res.status, 400, "must be rejected with 400");
      const body = await errorBody(res);
      assert.match(body.message, /quantity must be at most 100000/);
      assert.ok(
        Date.now() - started < 15000,
        "must return quickly — calculatePrice allocation was never reached"
      );
    });

    await test("sale: quantity MAX+1 → 400", async () => {
      const res = await httpPost(port, "/api/sales", {
        paymentType: "CASH",
        items: [{ productId: "p-seed", quantity: MAX_ITEM_QUANTITY + 1 }],
      });
      assert.equal(res.status, 400);
      const body = await errorBody(res);
      assert.match(body.message, /at most 100000/);
    });

    await test("sale: 101 items → 400", async () => {
      const res = await httpPost(port, "/api/sales", {
        paymentType: "CASH",
        items: itemsOfLength(MAX_ITEMS_PER_DOCUMENT + 1),
      });
      assert.equal(res.status, 400);
      const body = await errorBody(res);
      assert.match(body.message, /at most 100 entries/);
    });

    await test("purchase: costPerUnit MAX+1 → 400", async () => {
      const res = await httpPost(port, "/api/purchases", {
        supplierId: "s-seed",
        paymentType: "CASH",
        items: [{ productId: "p-seed", quantity: 1, costPerUnit: MAX_AMOUNT + 1 }],
      });
      assert.equal(res.status, 400);
      const body = await errorBody(res);
      assert.match(body.message, /costPerUnit must be at most 10000000/);
    });

    await test("customer-payment: amount MAX+1 → 400", async () => {
      const res = await httpPost(port, "/api/customer-payments", {
        customerId: "c-seed",
        amount: MAX_AMOUNT + 1,
      });
      assert.equal(res.status, 400);
      const body = await errorBody(res);
      assert.match(body.message, /amount must be at most 10000000/);
    });

    await test("supplier-payment: amount MAX+1 → 400", async () => {
      const res = await httpPost(port, "/api/supplier-payments", {
        supplierId: "s-seed",
        amount: MAX_AMOUNT + 1,
      });
      assert.equal(res.status, 400);
      const body = await errorBody(res);
      assert.match(body.message, /amount must be at most 10000000/);
    });

    await test("stock: DAMAGE quantity MAX+1 → 400", async () => {
      const res = await httpPost(port, "/api/stock/adjustments", {
        productId: "p-seed",
        reason: "DAMAGE",
        quantity: MAX_ITEM_QUANTITY + 1,
      });
      assert.equal(res.status, 400);
      const body = await errorBody(res);
      assert.match(body.message, /quantity must be at most 100000/);
    });

    await test("product: currentPrice MAX+1 → 400", async () => {
      const res = await httpPost(port, "/api/products", {
        name: "Leak",
        unit: "pcs",
        costPrice: 1,
        currentPrice: MAX_AMOUNT + 1,
      });
      assert.equal(res.status, 400);
      const body = await errorBody(res);
      assert.match(body.message, /currentPrice must be at most 10000000/);
    });

    // ── Boundary values still succeed through the full stack ────────────────
    await test("boundary: create product + CORRECTION to MAX stock → 201s", async () => {
      const product = await httpPost(port, "/api/products", {
        name: "Boundary Bulk",
        unit: "kg",
        costPrice: 100,
        currentPrice: 120,
      });
      assert.equal(product.status, 201);
      seededProductId = ((await product.json()) as { id: string }).id;

      const correction = await httpPost(port, "/api/stock/adjustments", {
        productId: seededProductId,
        reason: "CORRECTION",
        quantity: MAX_ITEM_QUANTITY,
        note: "test seed to boundary",
      });
      assert.equal(correction.status, 201, "CORRECTION to MAX stock succeeds");
    });

    await test("boundary: sale of MAX quantity → 201 (cap never binds legit data)", async () => {
      const res = await httpPost(port, "/api/sales", {
        paymentType: "CASH",
        items: [{ productId: seededProductId, quantity: MAX_ITEM_QUANTITY }],
      });
      assert.equal(res.status, 201);
    });

    // ── Liveness: the app never crashed under hostile input ──────────────────
    await test("liveness: GET /api/products → 200 after all hostile requests", async () => {
      const res = await httpGet(port, "/api/products");
      assert.equal(res.status, 200);
      const data = (await res.json()) as unknown[];
      assert.ok(Array.isArray(data));
    });
  } catch (error) {
    failed++;
    console.error("HARNESS FAIL");
    console.error(error);
  } finally {
    await stopServer(server);
    await resetDatabase();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();