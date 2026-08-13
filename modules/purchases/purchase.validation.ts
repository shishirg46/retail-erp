import { ValidationError } from "../../lib/errors";

import type {
  CreatePurchaseInput,
  PurchaseItemInput,
  PurchasePaymentType,
} from "./purchase.types";

const PURCHASE_PAYMENT_TYPES: readonly PurchasePaymentType[] = ["CASH", "CREDIT"];

function isPurchasePaymentType(value: unknown): value is PurchasePaymentType {
  return (
    typeof value === "string" &&
    (PURCHASE_PAYMENT_TYPES as readonly string[]).includes(value)
  );
}

function validatePurchaseItem(value: unknown, index: number): PurchaseItemInput {
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

  if (
    typeof item.costPerUnit !== "number" ||
    !Number.isFinite(item.costPerUnit) ||
    item.costPerUnit < 0
  ) {
    throw new ValidationError(`items[${index}].costPerUnit must be a non-negative number`);
  }

  return {
    productId: item.productId,
    quantity: item.quantity,
    costPerUnit: item.costPerUnit,
  };
}

export function validateCreatePurchaseInput(body: unknown): CreatePurchaseInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (typeof input.supplierId !== "string" || input.supplierId.length === 0) {
    throw new ValidationError("supplierId must be a non-empty string");
  }

  if (!isPurchasePaymentType(input.paymentType)) {
    throw new ValidationError(
      `paymentType must be one of: ${PURCHASE_PAYMENT_TYPES.join(", ")}`
    );
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError("items must be a non-empty array");
  }

  return {
    supplierId: input.supplierId,
    paymentType: input.paymentType,
    items: input.items.map(validatePurchaseItem),
  };
}