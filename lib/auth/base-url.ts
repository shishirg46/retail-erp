// Better Auth base URL resolution (Vercel preview support).
//
// A single static URL (BETTER_AUTH_URL) always wins. When it is unset, Better
// Auth is configured with a dynamic base URL: the request host is derived per
// request and validated against an allowlist, so local development (loopback)
// and Vercel deployments/previews (*.vercel.app) both resolve to the correct
// origin without hardcoding any single preview URL. Trusted origins are then
// derived from allowedHosts by Better Auth itself, so origin checks are never
// weakened.
//
// Set BETTER_AUTH_URL explicitly when a deployment uses a custom domain not
// covered by the allowlist (production custom domains in particular).

import type { BaseURLConfig } from "@better-auth/core";

export const LOCAL_FALLBACK_URL = "http://localhost:3000";

export const DYNAMIC_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "*.vercel.app"] as const;

// Dev-only exception for the LAN mobile test (16 Aug 2026): the phone reaches
// the dev server by IP (http://192.168.1.123:3000), and Better Auth's origin
// check (CSRF, origin-check middleware) rejects any state-changing request
// that carries a cookie whose Origin isn't in trustedOrigins — sign-out 403s.
// trustedOrigins derived from allowedHosts/fallback carry no port, and
// matchesOriginPattern needs an exact origin, so a LAN origin never matches.
// This entry is host-pinned with a port wildcard only; it is applied solely
// when NODE_ENV=development, so production keeps the strict check untouched.
export const DEV_LAN_TRUSTED_ORIGINS = ["http://192.168.1.123:*"] as const;

export function devLanTrustedOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return env.NODE_ENV === "development" ? [...DEV_LAN_TRUSTED_ORIGINS] : [];
}

export function resolveAuthBaseURL(env: Record<string, string | undefined> = process.env): BaseURLConfig {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  return {
    protocol: "auto",
    allowedHosts: [...DYNAMIC_ALLOWED_HOSTS],
    fallback: LOCAL_FALLBACK_URL,
  };
}
