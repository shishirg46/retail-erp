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

export function resolveAuthBaseURL(env: Record<string, string | undefined> = process.env): BaseURLConfig {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  return {
    protocol: "auto",
    allowedHosts: [...DYNAMIC_ALLOWED_HOSTS],
    fallback: LOCAL_FALLBACK_URL,
  };
}
