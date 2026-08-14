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

const { GET: authGet, POST: authPost } = toNextJsHandler(auth);

const ADMIN_PREFIX = "/api/auth/admin/";

function isAdminEndpoint(url: string): boolean {
  return new URL(url).pathname.startsWith(ADMIN_PREFIX);
}

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
  return authPost(request);
}
