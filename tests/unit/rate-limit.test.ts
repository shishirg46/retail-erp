// F-08 unit suite — process-local fixed-window rate limiter.
//
// Exercises the counter semantics directly (no HTTP): window reset behavior,
// key isolation, deterministic limit enforcement, env-driven configuration,
// and the auth/API entry points.

import { afterAll, describe, expect, it } from "vitest";

import {
  __resetRateLimits,
  clientKey,
  consumeApiRequest,
  consumeAuthAttempt,
} from "../../lib/rate-limit";
import { RateLimitError } from "../../lib/errors";

const ORIGINAL_ENV = { ...process.env };

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetRateLimits();
}

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  __resetRateLimits();
});

describe("consumeAuthAttempt (fixed window)", () => {
  it("allows up to the limit and rejects the next attempt in the same window", () => {
    setEnv({ ERP_RATE_LIMIT_AUTH_MAX: "3", ERP_RATE_LIMIT_AUTH_WINDOW_MS: "60000" });
    const req = { headers: new Headers() };

    for (let i = 0; i < 3; i++) {
      expect(() => consumeAuthAttempt(req)).not.toThrow();
    }
    expect(() => consumeAuthAttempt(req)).toThrow(RateLimitError);
    expect(() => consumeAuthAttempt(req)).toThrow(RateLimitError);
  });

  it("resets after the window elapses", async () => {
    setEnv({ ERP_RATE_LIMIT_AUTH_MAX: "2", ERP_RATE_LIMIT_AUTH_WINDOW_MS: "150" });
    const req = { headers: new Headers() };

    expect(() => consumeAuthAttempt(req)).not.toThrow();
    expect(() => consumeAuthAttempt(req)).not.toThrow();
    expect(() => consumeAuthAttempt(req)).toThrow(RateLimitError);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(() => consumeAuthAttempt(req)).not.toThrow();
  });

  it("keeps counters isolated per client key", () => {
    setEnv({ ERP_RATE_LIMIT_AUTH_MAX: "1", ERP_RATE_LIMIT_AUTH_WINDOW_MS: "60000" });
    const reqA = { headers: new Headers({ "x-forwarded-for": "10.0.0.1" }) };
    const reqB = { headers: new Headers({ "x-forwarded-for": "10.0.0.2" }) };

    expect(() => consumeAuthAttempt(reqA)).not.toThrow();
    expect(() => consumeAuthAttempt(reqA)).toThrow(RateLimitError);
    // A different client is unaffected.
    expect(() => consumeAuthAttempt(reqB)).not.toThrow();
  });
});

describe("consumeApiRequest (state-changing only)", () => {
  it("limits only state-changing methods", () => {
    setEnv({ ERP_RATE_LIMIT_API_MAX: "2", ERP_RATE_LIMIT_API_WINDOW_MS: "60000" });

    // Reads are never limited.
    expect(() => consumeApiRequest("u1", "GET")).not.toThrow();
    expect(() => consumeApiRequest("u1", "GET")).not.toThrow();
    expect(() => consumeApiRequest("u1", "GET")).not.toThrow();

    expect(() => consumeApiRequest("u1", "POST")).not.toThrow();
    expect(() => consumeApiRequest("u1", "POST")).not.toThrow();
    expect(() => consumeApiRequest("u1", "POST")).toThrow(RateLimitError);
    expect(() => consumeApiRequest("u1", "PATCH")).toThrow(RateLimitError);
    expect(() => consumeApiRequest("u1", "DELETE")).toThrow(RateLimitError);
  });

  it("keeps counters isolated per user id", () => {
    setEnv({ ERP_RATE_LIMIT_API_MAX: "1", ERP_RATE_LIMIT_API_WINDOW_MS: "60000" });
    expect(() => consumeApiRequest("u1", "POST")).not.toThrow();
    expect(() => consumeApiRequest("u1", "POST")).toThrow(RateLimitError);
    expect(() => consumeApiRequest("u2", "POST")).not.toThrow();
  });
});

describe("clientKey", () => {
  it("takes the left-most x-forwarded-for value", () => {
    const req = { headers: new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) };
    expect(clientKey(req)).toBe("203.0.113.7");
  });

  it("falls back to a stable sentinel without forwarding headers", () => {
    expect(clientKey({ headers: new Headers() })).toBe("unknown");
  });
});
