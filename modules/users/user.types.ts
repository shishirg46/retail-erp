export type UserRole = "OWNER" | "CASHIER";

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserInput {
  role: UserRole;
}

export interface PasswordResetInput {
  newPassword: string;
}

// Public admin view of a user — D9.10: the derived internal email
// (<username>@erp.local) is never exposed through the ERP API.
export interface UserAdminView {
  id: string;
  username: string | null;
  role: string | null;
  banned: boolean;
  banReason: string | null;
  banExpires: Date | null;
  createdAt: Date;
}

// Input for the repository's createUser call (full shape sent to Better Auth).
export interface CreateUserRepositoryInput {
  email: string;
  name: string;
  username: string;
  password: string;
  role: UserRole;
}

// Raw record shape returned by Better Auth's admin server APIs.
export interface RawUser {
  id: string;
  username?: string | null;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
  createdAt: Date;
}
