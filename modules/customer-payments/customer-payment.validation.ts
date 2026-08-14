import { MAX_AMOUNT } from "../../lib/bounds";
import { ValidationError } from "../../lib/errors";
import { rupeesToPaisa } from "../../lib/money";

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

  if (input.amount > MAX_AMOUNT) {
    throw new ValidationError(`amount must be at most ${MAX_AMOUNT}`);
  }

  if (input.saleId !== undefined && typeof input.saleId !== "string") {
    throw new ValidationError("saleId, when provided, must be a string");
  }

  return {
    customerId: input.customerId,
    amount: rupeesToPaisa(input.amount),
    ...(typeof input.saleId === "string" && input.saleId.length > 0
      ? { saleId: input.saleId }
      : {}),
  };
}