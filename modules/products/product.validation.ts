import { ValidationError } from "../../lib/errors";

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

  if (
    typeof tier.minQty !== "number" ||
    !Number.isInteger(tier.minQty) ||
    tier.minQty < 1
  ) {
    throw new ValidationError(
      `priceTiers[${index}].minQty must be a positive integer`
    );
  }

  if (!isPositiveFinite(tier.price)) {
    throw new ValidationError(
      `priceTiers[${index}].price must be a positive number`
    );
  }

  return { minQty: tier.minQty, price: tier.price };
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

  if (typeof input.unit !== "string" || input.unit.trim().length === 0) {
    throw new ValidationError("unit must be a non-empty string");
  }

  if (input.unit.length > UNIT_MAX_LENGTH) {
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

  if (!isPositiveFinite(input.currentPrice)) {
    throw new ValidationError("currentPrice must be a positive number");
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
    costPrice: input.costPrice,
    currentPrice: input.currentPrice,
    ...(priceTiers ? { priceTiers } : {}),
  };
}
