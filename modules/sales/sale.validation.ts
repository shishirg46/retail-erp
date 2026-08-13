import { ValidationError } from "../../lib/errors";

import type { CreateSaleInput, PaymentType, SaleItemInput } from "./sale.types";

const PAYMENT_TYPES: readonly PaymentType[] = ["CASH", "ECASH", "CREDIT"];

function isPaymentType(value: unknown): value is PaymentType {
  return typeof value === "string" && (PAYMENT_TYPES as readonly string[]).includes(value);
}

function validateSaleItem(value: unknown, index: number): SaleItemInput {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`items[${index}] must be an object`);
  }

  const item = value as Record<string, unknown>;

  if (typeof item.productId !== "string" || item.productId.length === 0) {
    throw new ValidationError(`items[${index}].productId must be a non-empty string`);
  }

  if (
    typeof item.quantity !== "number" ||
    !Number.isInteger(item.quantity) ||
    item.quantity < 1
  ) {
    throw new ValidationError(`items[${index}].quantity must be a positive integer`);
  }

  return { productId: item.productId, quantity: item.quantity };
}

// Request-level validation: checks the structure of the HTTP payload only.
// Business rules (stock, customer existence, pricing) live in SaleService.
export function validateCreateSaleInput(body: unknown): CreateSaleInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (!isPaymentType(input.paymentType)) {
    throw new ValidationError(`paymentType must be one of: ${PAYMENT_TYPES.join(", ")}`);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError("items must be a non-empty array");
  }

  if (input.customerId !== undefined && typeof input.customerId !== "string") {
    throw new ValidationError("customerId, when provided, must be a string");
  }

  return {
    paymentType: input.paymentType,
    ...(typeof input.customerId === "string" && input.customerId.length > 0
      ? { customerId: input.customerId }
      : {}),
    items: input.items.map(validateSaleItem),
  };
}