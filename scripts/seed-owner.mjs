// Seeds the initial OWNER account for F-10 (Better Auth) into the development
// database. Writes ONLY to the "user" and "account" tables (the two auth
// tables that carry user data). It is idempotent: if a user with the target
// username already exists, it exits without touching anything.
//
// The password is hashed with Better Auth's own scrypt implementation
// (@better-auth/utils/password) so the produced hash verifies at sign-in.
//
// Usage:
//   node scripts/seed-owner.mjs
//   OWNER_USERNAME=boss OWNER_PASSWORD='S3cure!pass' node scripts/seed-owner.mjs
//
// Env:
//   DATABASE_URL    dev DB connection string (defaults to local erp_retail)
//   OWNER_USERNAME  default "owner"
//   OWNER_PASSWORD  default "ownerpass123"

import pg from "pg";
import { hashPassword } from "@better-auth/utils/password";

const { Pool } = pg;

const DATABASE_URL = (
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/erp_retail?schema=public"
).replace(/\?schema=.*$/, "");

const USERNAME = (process.env.OWNER_USERNAME ?? "owner").toLowerCase();
const PASSWORD = process.env.OWNER_PASSWORD ?? "ownerpass123";
const EMAIL = `${USERNAME}@erp.local`;

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  const existing = await pool.query(`SELECT id FROM "user" WHERE email = $1`, [EMAIL]);
  if (existing.rowCount > 0) {
    console.log(`[seed-owner] OWNER "${USERNAME}" (${EMAIL}) already exists — nothing to do.`);
    await pool.end();
    return;
  }

  const hash = await hashPassword(PASSWORD);
  const userId = crypto.randomUUID();
  const now = new Date();

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, role, banned)
       VALUES ($1, $2, $3, true, $4, $4, $2, 'OWNER', false)`,
      [userId, USERNAME, EMAIL, now],
    );
    await pool.query(
      `INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $3, $4, $5, $5)`,
      [crypto.randomUUID(), userId, userId, hash, now],
    );
    await pool.query("COMMIT");
    console.log(`[seed-owner] OWNER "${USERNAME}" created (id=${userId}).`);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[seed-owner] FAILED:", error.message);
  process.exit(1);
});
