import { ValidationError } from "../../lib/errors";

import type { CreateSupplierPaymentInput } from "./supplier-payment.types";

export function validateCreateSupplierPaymentInput(
  body: unknown
): CreateSupplierPaymentInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (typeof input.supplierId !== "string" || input.supplierId.length === 0) {
    throw new ValidationError("supplierId must be a non-empty string");
  }

  if (
    typeof input.amount !== "number" ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0
  ) {
    throw new ValidationError("amount must be a positive number");
  }

  return {
    supplierId: input.supplierId,
    amount: input.amount,
  };
}