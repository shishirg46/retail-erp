import { ValidationError } from "../../lib/errors";
import type { CreateUserInput, PasswordResetInput, UpdateUserInput, UserRole } from "./user.types";

const ROLES: readonly string[] = ["OWNER", "CASHIER"];
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const PASSWORD_MIN = 8;

function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && ROLES.includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateCreateUserInput(body: unknown): CreateUserInput {
  if (!isObject(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const { username, password, role } = body;
  if (typeof username !== "string" || username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    throw new ValidationError(`username must be a string of ${USERNAME_MIN}-${USERNAME_MAX} characters`);
  }
  if (!USERNAME_RE.test(username)) {
    throw new ValidationError("username may contain only letters, digits, and underscores");
  }
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    throw new ValidationError(`password must be at least ${PASSWORD_MIN} characters`);
  }
  if (!isRole(role)) {
    throw new ValidationError(`role must be one of: ${ROLES.join(", ")}`);
  }
  return { username, password, role };
}

export function validateUpdateUserInput(body: unknown): UpdateUserInput {
  if (!isObject(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const { role } = body;
  if (!isRole(role)) {
    throw new ValidationError(`role must be one of: ${ROLES.join(", ")}`);
  }
  return { role };
}

export function validatePasswordResetInput(body: unknown): PasswordResetInput {
  if (!isObject(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const { newPassword } = body;
  if (typeof newPassword !== "string" || newPassword.length < PASSWORD_MIN) {
    throw new ValidationError(`newPassword must be at least ${PASSWORD_MIN} characters`);
  }
  return { newPassword };
}
