import { rupeesToPaisa } from "../../lib/money";
import { ValidationError } from "../../lib/errors";

import type { CreateCustomerInput } from "./customer.types";

export function validateCreateCustomerInput(body: unknown): CreateCustomerInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new ValidationError("name must be a non-empty string");
  }

  if (input.contact !== undefined && typeof input.contact !== "string") {
    throw new ValidationError("contact, when provided, must be a string");
  }

  // D26: openingBalance is the historical customer balance at ERP go-live.
  // It is a signed rupee amount (positive = customer owes, negative = prepaid).
  // Set once at creation; immutable through normal business operations.
  let openingBalance: number | undefined;

  if (input.openingBalance !== undefined) {
    if (
      typeof input.openingBalance !== "number" ||
      !Number.isFinite(input.openingBalance)
    ) {
      throw new ValidationError(
        "openingBalance, when provided, must be a finite number"
      );
    }

    openingBalance = rupeesToPaisa(input.openingBalance);
  }

  return {
    name: input.name.trim(),
    ...(typeof input.contact === "string" && input.contact.length > 0
      ? { contact: input.contact }
      : {}),
    ...(openingBalance !== undefined ? { openingBalance } : {}),
  };
}