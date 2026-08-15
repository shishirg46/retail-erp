// Process-local rate limiting (F-08).
//
// DEPLOYMENT MODEL: this limiter is intentionally process-local (in-memory,
// single Node process). The ERP backend currently deploys as one Next.js
// process per instance (`next dev` / `next start`), and no Redis or external
// cache exists. Under a single instance the counters are exact. If the
// deployment ever scales to multiple instances, each instance carries its own
// counters — a distributed backend must replace this module with a shared
// store (e.g. Redis) rather than pretending these counts are global.
//
// Window semantics: fixed window (deterministic; a burst at a window boundary
// is the accepted trade-off). A `consume(key)` call returns whether the key is
// still under its limit and how long until the current window resets.

import { RateLimitError } from "./errors";

// Minimal request shape — works with both `NextRequest` (route handlers) and
// plain `Request` (the Better Auth proxy handler).
export interface HeaderSource {
  headers: { get(name: string): string | null };
}

// ─── Configuration (read at call time so tests can vary it per server) ───────

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const AUTH_MAX = () => parseIntEnv("ERP_RATE_LIMIT_AUTH_MAX", 20);
const AUTH_WINDOW_MS = () => parseIntEnv("ERP_RATE_LIMIT_AUTH_WINDOW_MS", 15 * 60 * 1000);
const API_MAX = () => parseIntEnv("ERP_RATE_LIMIT_API_MAX", 300);
const API_WINDOW_MS = () => parseIntEnv("ERP_RATE_LIMIT_API_WINDOW_MS", 60 * 1000);

// ─── Fixed-window counters ────────────────────────────────────────────────────

interface WindowState {
  start: number;
  count: number;
}

// Keyed by a request-scoped string (IP for auth, user id for the API).
// Node is single-threaded, so the Map is mutated synchronously and needs no
// locking.
const windows = new Map<string, WindowState>();

function consume(key: string, limit: number, windowMs: number): { retryAfterMs: number } {
  const now = Date.now();
  const state = windows.get(key);

  if (!state || now >= state.start + windowMs) {
    windows.set(key, { start: now, count: 1 });
    return { retryAfterMs: 0 };
  }

  if (state.count >= limit) {
    return { retryAfterMs: state.start + windowMs - now };
  }

  state.count += 1;
  return { retryAfterMs: 0 };
}

// Best-effort sweep of expired keys so the map cannot grow unboundedly.
// Runs on a fraction of calls (cheap modulo on the map size).
function sweep(now: number): void {
  for (const [key, state] of windows) {
    if (now >= state.start + AUTH_WINDOW_MS()) {
      windows.delete(key);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract a client identifier from the request. Uses the left-most
 * `x-forwarded-for` value when present (reverse-proxy deployment), otherwise
 * a stable "unknown" sentinel (direct connection).
 */
export function clientKey(req: HeaderSource): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return "unknown";
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Rate-limit authentication attempts (brute-force protection). Consumes one
 * attempt per key per call and throws RateLimitError when the limit is hit.
 * Applied only to credential-verification endpoints (sign-in), never to
 * session checks.
 */
export function consumeAuthAttempt(req: HeaderSource): void {
  const { retryAfterMs } = consume(clientKey(req), AUTH_MAX(), AUTH_WINDOW_MS());
  if (retryAfterMs > 0) {
    sweep(Date.now());
    throw new RateLimitError();
  }
}

/**
 * Rate-limit state-changing API requests for an authenticated caller.
 * Read requests are intentionally not limited. Consumes one unit per
 * (user id) per state-changing request.
 */
export function consumeApiRequest(userId: string, method: string): void {
  if (!STATE_CHANGING_METHODS.has(method)) return;
  const { retryAfterMs } = consume(userId, API_MAX(), API_WINDOW_MS());
  if (retryAfterMs > 0) {
    sweep(Date.now());
    throw new RateLimitError();
  }
}

/** Test hook: clear all in-process counters. */
export function __resetRateLimits(): void {
  windows.clear();
}
