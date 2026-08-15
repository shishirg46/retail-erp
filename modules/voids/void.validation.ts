import { ValidationError } from "../../lib/errors";

export interface ValidVoidInput {
  reason: string;
  note?: string;
}

export function validateVoidInput(body: unknown): ValidVoidInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new ValidationError("reason must be a non-empty string");
  }

  if (input.reason.length > 500) {
    throw new ValidationError("reason must be at most 500 characters");
  }

  let note: string | undefined;
  if (input.note !== undefined) {
    if (typeof input.note !== "string") {
      throw new ValidationError("note, when provided, must be a string");
    }

    if (input.note.length > 1000) {
      throw new ValidationError("note must be at most 1000 characters");
    }

    if (input.note.length > 0) {
      note = input.note;
    }
  }

  return { reason: input.reason, note };
}
