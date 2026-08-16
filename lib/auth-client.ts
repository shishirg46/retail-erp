// Client-side Better Auth wrapper (D22.1). The same plugins must be declared
// here and in lib/auth.ts so the typed client exposes username sign-in and the
// admin surface used by user management later.

"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [usernameClient(), adminClient()],
});
