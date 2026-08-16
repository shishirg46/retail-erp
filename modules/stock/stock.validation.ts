import { MAX_ITEM_QUANTITY } from "../../lib/bounds";
import { ValidationError } from "../../lib/errors";
import { hasAtMostTwoDecimals, quantityToUnits } from "../../lib/quantity";

import type {
  AdjustStockInput,
  StockAdjustmentReason,
} from "./stock.types";

const ADJUSTMENT_REASONS: readonly StockAdjustmentReason[] = ["DAMAGE", "CORRECTION"];

function isStockAdjustmentReason(value: unknown): value is StockAdjustmentReason {
  return (
    typeof value === "string" &&
    (ADJUSTMENT_REASONS as readonly string[]).includes(value)
  );
}

export function validateAdjustStockInput(body: unknown): AdjustStockInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (typeof input.productId !== "string" || input.productId.length === 0) {
    throw new ValidationError("productId must be a non-empty string");
  }

  if (!isStockAdjustmentReason(input.reason)) {
    throw new ValidationError(
      `reason must be one of: ${ADJUSTMENT_REASONS.join(", ")}`
    );
  }

  // D25.2/D25.5: DAMAGE counts the amount ruined -> a positive quantity (up to
  // 2 dp for measurable units); CORRECTION is a target level -> non-negative.
  // The unit precision rule (pcs integers) needs the product, so it is
  // enforced in StockService where the product is known (D25.1).
  if (input.reason === "DAMAGE") {
    if (
      typeof input.quantity !== "number" ||
      !hasAtMostTwoDecimals(input.quantity) ||
      input.quantity <= 0
    ) {
      throw new ValidationError(
        "quantity must be a positive number with at most 2 decimal places for DAMAGE"
      );
    }
  } else {
    if (
      typeof input.quantity !== "number" ||
      !hasAtMostTwoDecimals(input.quantity) ||
      input.quantity < 0
    ) {
      throw new ValidationError(
        "quantity must be a non-negative number with at most 2 decimal places for CORRECTION"
      );
    }
  }

  if (input.quantity > MAX_ITEM_QUANTITY) {
    throw new ValidationError(`quantity must be at most ${MAX_ITEM_QUANTITY}`);
  }

  if (input.note !== undefined && typeof input.note !== "string") {
    throw new ValidationError("note, when provided, must be a string");
  }

  return {
    productId: input.productId,
    reason: input.reason,
    quantity: quantityToUnits(input.quantity),
    ...(typeof input.note === "string" && input.note.length > 0
      ? { note: input.note }
      : {}),
  };
}