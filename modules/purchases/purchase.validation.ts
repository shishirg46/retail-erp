import {
  MAX_AMOUNT,
  MAX_ITEM_QUANTITY,
  MAX_ITEMS_PER_DOCUMENT,
} from "../../lib/bounds";
import { ValidationError } from "../../lib/errors";
import { rupeesToPaisa } from "../../lib/money";
import { hasAtMostTwoDecimals, quantityToUnits } from "../../lib/quantity";

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

  // D25.2: quantity accepts up to 2 dp. The unit precision rule (pcs
  // integers) needs the product, so it is enforced in PurchaseService where
  // the product is known (D25.1).
  if (
    typeof item.quantity !== "number" ||
    !hasAtMostTwoDecimals(item.quantity) ||
    item.quantity <= 0
  ) {
    throw new ValidationError(
      `items[${index}].quantity must be a positive number with at most 2 decimal places`
    );
  }

  if (item.quantity > MAX_ITEM_QUANTITY) {
    throw new ValidationError(
      `items[${index}].quantity must be at most ${MAX_ITEM_QUANTITY}`
    );
  }

  if (
    typeof item.costPerUnit !== "number" ||
    !Number.isFinite(item.costPerUnit) ||
    item.costPerUnit < 0
  ) {
    throw new ValidationError(`items[${index}].costPerUnit must be a non-negative number`);
  }

  if (item.costPerUnit > MAX_AMOUNT) {
    throw new ValidationError(
      `items[${index}].costPerUnit must be at most ${MAX_AMOUNT}`
    );
  }

  return {
    productId: item.productId,
    quantity: quantityToUnits(item.quantity),
    costPerUnit: rupeesToPaisa(item.costPerUnit),
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

  if (input.items.length > MAX_ITEMS_PER_DOCUMENT) {
    throw new ValidationError(
      `items must contain at most ${MAX_ITEMS_PER_DOCUMENT} entries`
    );
  }

  return {
    supplierId: input.supplierId,
    paymentType: input.paymentType,
    items: input.items.map(validatePurchaseItem),
  };
}