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

  return {
    name: input.name.trim(),
    ...(typeof input.contact === "string" && input.contact.length > 0
      ? { contact: input.contact }
      : {}),
  };
}