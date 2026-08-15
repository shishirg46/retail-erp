// Better Auth HTTP endpoints (D9, F-10): sign-in, sign-out, get-session,
// mounted under /api/auth/*.
//
// D9.10: the admin plugin's endpoints (/api/auth/admin/*) return the derived
// internal email (<username>@erp.local), so they are blocked here with a 404.
// OWNER user administration is served by /api/users/*, which never exposes
// the internal email.

import { NextResponse } from "next/server";

import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { consumeAuthAttempt } from "@/lib/rate-limit";
import { toHttpResponse } from "@/lib/response";

const { GET: authGet, POST: authPost } = toNextJsHandler(auth);

const ADMIN_PREFIX = "/api/auth/admin/";

function isAdminEndpoint(url: string): boolean {
  return new URL(url).pathname.startsWith(ADMIN_PREFIX);
}

// Credential-verification endpoints that are subject to brute-force rate
// limiting (F-08). Session/lifecycle endpoints (get-session, sign-out) are
// deliberately not limited so legitimate flows are never disrupted.
const SIGN_IN_PATHS = new Set(["/api/auth/sign-in/email", "/api/auth/sign-in/username"]);

export async function GET(request: Request) {
  if (isAdminEndpoint(request.url)) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }
  return authGet(request);
}

export async function POST(request: Request) {
  if (isAdminEndpoint(request.url)) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  try {
    if (SIGN_IN_PATHS.has(new URL(request.url).pathname)) {
      consumeAuthAttempt(request);
    }
    return authPost(request);
  } catch (error) {
    return toHttpResponse(error);
  }
}
