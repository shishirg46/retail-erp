import { MAX_AMOUNT, MAX_ITEM_QUANTITY } from "../../lib/bounds";
import { ValidationError } from "../../lib/errors";
import { rupeesToPaisa } from "../../lib/money";
import {
  hasAtMostTwoDecimals,
  isSupportedUnit,
  quantityToUnits,
} from "../../lib/quantity";

import type { CreateProductInput, PriceTier } from "./product.types";

const NAME_MAX_LENGTH = 200;
const UNIT_MAX_LENGTH = 50;
const CATEGORY_MAX_LENGTH = 100;
const MAX_TIERS = 50;

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validatePriceTier(value: unknown, index: number): PriceTier {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`priceTiers[${index}] must be an object`);
  }

  const tier = value as Record<string, unknown>;

  // D25.2/D25.4: minQty accepts up to 2 dp (fractional tier thresholds such as
  // a 2.5 kg tier). The unit's precision rule (pcs integers) is applied where
  // the unit is known — the product validator owns it for the whole product.
  if (
    typeof tier.minQty !== "number" ||
    !hasAtMostTwoDecimals(tier.minQty) ||
    tier.minQty <= 0
  ) {
    throw new ValidationError(
      `priceTiers[${index}].minQty must be a positive number with at most 2 decimal places`
    );
  }

  if (tier.minQty > MAX_ITEM_QUANTITY) {
    throw new ValidationError(
      `priceTiers[${index}].minQty must be at most ${MAX_ITEM_QUANTITY}`
    );
  }

  if (!isPositiveFinite(tier.price)) {
    throw new ValidationError(
      `priceTiers[${index}].price must be a positive number`
    );
  }

  if (tier.price > MAX_AMOUNT) {
    throw new ValidationError(
      `priceTiers[${index}].price must be at most ${MAX_AMOUNT}`
    );
  }

  // Prices arrive in rupees and are converted exactly once to paisa here (D11).
  // minQty arrives in human units and converts exactly once to scaled units.
  return { minQty: quantityToUnits(tier.minQty), price: rupeesToPaisa(tier.price) };
}

// Request-level validation: checks the structure of the HTTP payload only.
// Business rules (e.g. pricing math) live in the service.
export function validateCreateProductInput(body: unknown): CreateProductInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new ValidationError("name must be a non-empty string");
  }

  if (input.name.length > NAME_MAX_LENGTH) {
    throw new ValidationError(
      `name must be at most ${NAME_MAX_LENGTH} characters`
    );
  }

  if (
    typeof input.unit !== "string" ||
    input.unit.trim().length === 0 ||
    !isSupportedUnit(input.unit.trim())
  ) {
    throw new ValidationError(
      "unit must be one of: pcs, kg, g, liter, ml (D25.1)"
    );
  }

  if (input.unit.trim().length > UNIT_MAX_LENGTH) {
    throw new ValidationError(
      `unit must be at most ${UNIT_MAX_LENGTH} characters`
    );
  }

  if (
    input.category !== undefined &&
    (typeof input.category !== "string" || input.category.length > CATEGORY_MAX_LENGTH)
  ) {
    throw new ValidationError(
      `category, when provided, must be a string of at most ${CATEGORY_MAX_LENGTH} characters`
    );
  }

  if (!isNonNegativeFinite(input.costPrice)) {
    throw new ValidationError("costPrice must be a non-negative number");
  }

  if (input.costPrice > MAX_AMOUNT) {
    throw new ValidationError(`costPrice must be at most ${MAX_AMOUNT}`);
  }

  if (!isPositiveFinite(input.currentPrice)) {
    throw new ValidationError("currentPrice must be a positive number");
  }

  if (input.currentPrice > MAX_AMOUNT) {
    throw new ValidationError(`currentPrice must be at most ${MAX_AMOUNT}`);
  }

  let priceTiers: PriceTier[] | undefined;

  if (input.priceTiers !== undefined) {
    if (!Array.isArray(input.priceTiers)) {
      throw new ValidationError("priceTiers, when provided, must be an array");
    }

    if (input.priceTiers.length > MAX_TIERS) {
      throw new ValidationError(
        `priceTiers must contain at most ${MAX_TIERS} entries`
      );
    }

    priceTiers = input.priceTiers.map(validatePriceTier);

    // D25.1: pcs products can only have whole-number tier thresholds.
    if (input.unit.trim() === "pcs") {
      for (const tier of priceTiers) {
        if (tier.minQty % 100 !== 0) {
          throw new ValidationError(
            `priceTiers minQty must be a whole number for pcs products`
          );
        }
      }
    }

    const seenMinQty = new Set<number>();

    for (const tier of priceTiers) {
      if (seenMinQty.has(tier.minQty)) {
        throw new ValidationError(
          `priceTiers contains a duplicate minQty (${tier.minQty})`
        );
      }

      seenMinQty.add(tier.minQty);
    }
  }

  return {
    name: input.name.trim(),
    category:
      typeof input.category === "string" && input.category.length > 0
        ? input.category
        : undefined,
    unit: input.unit.trim(),
    costPrice: rupeesToPaisa(input.costPrice),
    currentPrice: rupeesToPaisa(input.currentPrice),
    ...(priceTiers ? { priceTiers } : {}),
  };
}
