// Shared HTTP harness for suites that spawn a real Next.js dev server.
//
// Everything related to the dev-server lifecycle lives here: the
// `erp_retail_test` guard, foreign-server detection (Next 16 refuses a second
// dev server in the same project via `.next/dev/lock`), spawn/wait/stop, and
// the curl-free fetch helpers. Suites that need a server import these instead
// of duplicating the ~200 lines of lifecycle plumbing.

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { resolveTestDbUrl } from "./db";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
export const NEXT_BIN = path.join(
  REPO_ROOT,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);

const LOCK_PATH = path.join(REPO_ROOT, ".next", "dev", "lock");

interface DevLock {
  pid: number;
  port: number;
  hostname: string;
  appUrl: string;
  startedAt: number;
}

export interface Server {
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

// Next 16 dev writes `.next/dev/lock` and refuses a second dev server in the
// same project directory. A foreign (developer's) dev server would therefore
// block every spawned-server suite and must be surfaced clearly instead of
// silently timing out. Stale locks from killed servers are cleaned.
export async function ensureNoForeignDevServer(): Promise<void> {
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
    throw new Error(
      `A Next dev server is already running for this project ` +
        `(pid ${lock.pid}, ${lock.appUrl}). Stop it before running this HTTP ` +
        `suite — two dev servers cannot share .next/dev.`
    );
  }

  try {
    await unlink(LOCK_PATH); // stale lock from a killed server
  } catch {
    // best-effort
  }
}

export function startServer(port: number, databaseUrl?: string): Server {
  const url = databaseUrl ?? resolveTestDbUrl();
  const child = spawn(
    process.execPath,
    [NEXT_BIN, "dev", "-p", String(port)],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_URL: url,
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

export async function stopServer(server: Server): Promise<void> {
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

export async function waitReady(
  server: Server,
  probePath = "/api/products",
  timeoutMs = 180000
): Promise<void> {
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
      const res = await fetch(`http://127.0.0.1:${port}${probePath}`, {
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

export async function httpGet(port: number, urlPath: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, {
    signal: AbortSignal.timeout(60000),
  });
}

export async function httpPost(
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

// POST a raw text body unchanged (no JSON.stringify) — sends genuinely
// malformed JSON so the route's `req.json()` path is exercised.
export async function httpPostRaw(
  port: number,
  urlPath: string,
  rawText: string
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "content-type": "application/json" },
    body: rawText,
  });
}

export async function errorBody(res: Response): Promise<{ message: string }> {
  const data = (await res.json()) as { message?: unknown };
  assert.equal(typeof data.message, "string", "error body must have a string message");
  assert.equal(Object.keys(data).length, 1, "error body must contain only `message`");
  return data as { message: string };
}

// Test-only client bound to the (guard-verified) test database.
export function createServerPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: resolveTestDbUrl() }),
  });
}