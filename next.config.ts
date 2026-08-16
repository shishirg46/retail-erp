import type { NextConfig } from "next";

// Security hardening (F-11).
//
// Baseline security headers are applied to every response. The API is a
// JSON-only backend with no embedded content, so its CSP is maximally strict.
// UI pages ship a nonce-based CSP (scripts) from proxy.ts (D21.1/D22); this
// file only adds the baseline headers + the API's strict CSP.
//
// CORS: this is a single-shop ERP with no cross-origin frontend requirement.
// No Access-Control-Allow-* headers are emitted at all, so browsers enforce
// same-origin by default (reads AND writes). The application-level same-origin
// gate (D9.9) already rejects cross-origin state-changing requests. If a
// cross-origin client is ever required, a restrictive allow-list must be
// configured behind a PM decision — never a wildcard.

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
