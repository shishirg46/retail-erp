// Shared Vitest setup, run once per worker before any test file.
//
// Loads `.env` (DATABASE_URL / TEST_DATABASE_URL) so the DB-touching suites
// and the erp_retail_test guard see the same environment regardless of how
// they are invoked. The guard itself is enforced by `resolveTestDbUrl` in
// tests/helpers/db.ts, which throws rather than touching any other database.

import "dotenv/config";