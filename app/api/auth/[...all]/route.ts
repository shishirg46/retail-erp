// Better Auth HTTP endpoints (D9, F-10): sign-in, sign-out, get-session, and
// the admin plugin endpoints, all mounted under /api/auth/*.

import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
