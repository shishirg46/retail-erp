// Route-level identifier validation (P3).
//
// Domain entities (product, customer, supplier, sale, purchase, payment,
// stock movement, void record) use UUID ids — see prisma/schema.prisma.
// User ids are NOT uniformly UUIDs: Better Auth's generateId(32) produces a
// 32-char [a-zA-Z0-9] id for users created via the API, while seeded users
// carry explicit UUIDs. Both must be accepted for /api/users/* routes.

import { ValidationError } from "./errors";

// Structural UUID check: the 8-4-4-4-12 hex shape. Deliberately not
// version/variant-restricted — any well-formed UUID string is a valid key for
// the route boundary; the only thing rejected here is non-UUID garbage.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BETTER_AUTH_ID_RE = /^[a-zA-Z0-9]{32}$/;

export function assertUuid(value: string, fieldName = "id"): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${fieldName} format: expected a UUID`);
  }
}

export function assertUserId(value: string, fieldName = "id"): void {
  if (!UUID_RE.test(value) && !BETTER_AUTH_ID_RE.test(value)) {
    throw new ValidationError(
      `Invalid ${fieldName} format: expected a UUID or a 32-character user id`
    );
  }
}
