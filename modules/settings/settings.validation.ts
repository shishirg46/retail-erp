import { rupeesToPaisa } from "../../lib/money";
import { ValidationError } from "../../lib/errors";

import type { UpdateSettingsInput } from "./settings.types";

export function validateUpdateSettingsInput(body: unknown): UpdateSettingsInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;
  const result: UpdateSettingsInput = {};

  if (input.goLiveAt !== undefined) {
    if (typeof input.goLiveAt !== "string") {
      throw new ValidationError("goLiveAt, when provided, must be an ISO date string");
    }

    const date = new Date(input.goLiveAt);

    if (isNaN(date.getTime())) {
      throw new ValidationError("goLiveAt must be a valid date");
    }

    result.goLiveAt = date;
  }

  // D26: walletOpeningBalance is the cash-box balance at ERP go-live.
  // It is a rupee amount; stored as paisa internally.
  if (input.walletOpeningBalance !== undefined) {
    if (
      typeof input.walletOpeningBalance !== "number" ||
      !Number.isFinite(input.walletOpeningBalance)
    ) {
      throw new ValidationError(
        "walletOpeningBalance, when provided, must be a finite number"
      );
    }

    result.walletOpeningBalance = rupeesToPaisa(input.walletOpeningBalance);
  }

  return result;
}
