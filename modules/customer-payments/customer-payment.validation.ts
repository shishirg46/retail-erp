import { ValidationError } from "../../lib/errors";

import type { CreateCustomerPaymentInput } from "./customer-payment.types";

export function validateCreateCustomerPaymentInput(
  body: unknown
): CreateCustomerPaymentInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (typeof input.customerId !== "string" || input.customerId.length === 0) {
    throw new ValidationError("customerId must be a non-empty string");
  }

  if (
    typeof input.amount !== "number" ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0
  ) {
    throw new ValidationError("amount must be a positive number");
  }

  if (input.saleId !== undefined && typeof input.saleId !== "string") {
    throw new ValidationError("saleId, when provided, must be a string");
  }

  return {
    customerId: input.customerId,
    amount: input.amount,
    ...(typeof input.saleId === "string" && input.saleId.length > 0
      ? { saleId: input.saleId }
      : {}),
  };
}