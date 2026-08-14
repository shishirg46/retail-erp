// F-10 unit coverage for the OWNER user-administration input boundary and the
// D9.10 mapper (internal email never reaches the API view).

import { describe, expect, it } from "vitest";

import {
  validateCreateUserInput,
  validatePasswordResetInput,
  validateUpdateUserInput,
} from "../../modules/users/user.validation";
import { ValidationError } from "../../lib/errors";
import { toUserAdminView } from "../../modules/users/user.mapper";

describe("validateCreateUserInput", () => {
  it("accepts a valid payload", () => {
    expect(
      validateCreateUserInput({ username: "new_user", password: "password123", role: "CASHIER" }),
    ).toEqual({ username: "new_user", password: "password123", role: "CASHIER" });
  });

  it("rejects a non-object body", () => {
    expect(() => validateCreateUserInput("nope")).toThrow(ValidationError);
    expect(() => validateCreateUserInput(null)).toThrow(ValidationError);
  });

  it("rejects usernames that are too short / too long", () => {
    expect(() =>
      validateCreateUserInput({ username: "ab", password: "password123", role: "CASHIER" }),
    ).toThrow(/username/);
    expect(() =>
      validateCreateUserInput({ username: "a".repeat(31), password: "password123", role: "CASHIER" }),
    ).toThrow(/username/);
  });

  it("rejects usernames with forbidden characters", () => {
    expect(() =>
      validateCreateUserInput({ username: "bad name", password: "password123", role: "CASHIER" }),
    ).toThrow(/letters, digits, and underscores/);
    expect(() =>
      validateCreateUserInput({ username: "bad-name", password: "password123", role: "CASHIER" }),
    ).toThrow(/letters, digits, and underscores/);
  });

  it("rejects short passwords", () => {
    expect(() =>
      validateCreateUserInput({ username: "good_user", password: "short", role: "CASHIER" }),
    ).toThrow(/at least 8/);
  });

  it("rejects roles outside OWNER/CASHIER", () => {
    expect(() =>
      validateCreateUserInput({ username: "good_user", password: "password123", role: "SUPERUSER" }),
    ).toThrow(/role must be one of/);
  });
});

describe("validateUpdateUserInput", () => {
  it("accepts a role change", () => {
    expect(validateUpdateUserInput({ role: "OWNER" })).toEqual({ role: "OWNER" });
  });

  it("rejects a missing or invalid role", () => {
    expect(() => validateUpdateUserInput({})).toThrow(/role must be one of/);
    expect(() => validateUpdateUserInput({ role: "admin" })).toThrow(/role must be one of/);
    expect(() => validateUpdateUserInput("x")).toThrow(ValidationError);
  });
});

describe("validatePasswordResetInput", () => {
  it("accepts a valid new password", () => {
    expect(validatePasswordResetInput({ newPassword: "freshpass123" })).toEqual({
      newPassword: "freshpass123",
    });
  });

  it("rejects short or malformed payloads", () => {
    expect(() => validatePasswordResetInput({ newPassword: "tiny" })).toThrow(/at least 8/);
    expect(() => validatePasswordResetInput({})).toThrow(/newPassword/);
    expect(() => validatePasswordResetInput(null)).toThrow(ValidationError);
  });
});

describe("toUserAdminView (D9.10)", () => {
  it("never exposes the internal derived email", () => {
    const raw = {
      id: "u1",
      username: "cashier1",
      role: "CASHIER",
      banned: true,
      banReason: "no reason",
      banExpires: null,
      createdAt: new Date("2026-08-14T00:00:00Z"),
      email: "cashier1@erp.local",
      emailVerified: true,
    };
    const view = toUserAdminView(raw);
    expect(view).toEqual({
      id: "u1",
      username: "cashier1",
      role: "CASHIER",
      banned: true,
      banReason: "no reason",
      banExpires: null,
      createdAt: new Date("2026-08-14T00:00:00Z"),
    });
    expect(view).not.toHaveProperty("email");
    expect(view).not.toHaveProperty("emailVerified");
  });
});
