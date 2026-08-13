// Centralized application errors.
// Routes convert these into HTTP responses via toHttpResponse().

export class AppError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
  }
}

// 400 — the request structure / payload is invalid.
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

// 404 — the referenced entity does not exist.
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404);
  }
}

// 409 — the operation is valid but conflicts with current state.
export class InsufficientStockError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

// 400 — the operation violates a business rule.
export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

// 409 — a duplicate/conflicting record was attempted.
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}