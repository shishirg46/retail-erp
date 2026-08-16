// Sign-in form schema (D22.2) — mirrors the backend login contract:
// username + password (D9, better-auth username plugin) and the 8-char
// minimum from lib/auth.ts. The server stays authoritative; this schema only
// gives the form fast, inline feedback.

import { z } from "zod";

import { MIN_PASSWORD_LENGTH } from "../constants";

export const signInSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Username is required"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
});

export type SignInInput = z.infer<typeof signInSchema>;
