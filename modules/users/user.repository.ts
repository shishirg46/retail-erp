import { APIError } from "better-auth";
import { auth } from "../../lib/auth";
import { AppError, ConflictError, NotFoundError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { toUserAdminView } from "./user.mapper";
import type { CreateUserRepositoryInput, RawUser, UserAdminView, UserRole } from "./user.types";

type Db = {
  user: typeof prisma.user;
};

// Normalize Better Auth's APIError into the application error taxonomy.
function toAppError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof APIError) {
    const status = typeof error.statusCode === "number" ? error.statusCode : 400;
    const message = error.message || "Bad Request";
    if (status === 404) throw new NotFoundError(message);
    if (status === 409) throw new ConflictError(message);
    throw new AppError(message, status);
  }
  throw error;
}

export class PrismaUserRepository {
  constructor(
    private readonly db: Db = prisma,
    private readonly authApi = auth.api,
  ) {}

  // All admin calls below must be invoked with the requesting OWNER's headers,
  // so Better Auth authenticates and enforces the caller's permissions.
  async listUsers(headers: Headers): Promise<UserAdminView[]> {
    const result = await this.authApi.listUsers({ headers, query: {} }).catch(toAppError);
    return result.users.map((user: RawUser) => toUserAdminView(user));
  }

  async createUser(headers: Headers, input: CreateUserRepositoryInput): Promise<UserAdminView> {
    const user = await this.authApi
      .createUser({
        headers,
        body: {
          email: input.email,
          name: input.name,
          password: input.password,
          role: input.role,
          data: { username: input.username },
        },
      })
      .catch(toAppError);
    return toUserAdminView(user.user);
  }

  async findUserById(headers: Headers, id: string): Promise<UserAdminView> {
    const user = await this.authApi.getUser({ headers, query: { id } }).catch(toAppError);
    return toUserAdminView(user);
  }

  async updateRole(headers: Headers, userId: string, role: UserRole): Promise<UserAdminView> {
    const user = await this.authApi.setRole({ headers, body: { userId, role } }).catch(toAppError);
    return toUserAdminView(user.user);
  }

  async ban(headers: Headers, userId: string): Promise<UserAdminView> {
    const user = await this.authApi.banUser({ headers, body: { userId } }).catch(toAppError);
    return toUserAdminView(user.user);
  }

  async unban(headers: Headers, userId: string): Promise<UserAdminView> {
    const user = await this.authApi.unbanUser({ headers, body: { userId } }).catch(toAppError);
    return toUserAdminView(user.user);
  }

  async remove(headers: Headers, userId: string): Promise<void> {
    await this.authApi.removeUser({ headers, body: { userId } }).catch(toAppError);
  }

  async setPassword(headers: Headers, userId: string, newPassword: string): Promise<void> {
    await this.authApi
      .setUserPassword({ headers, body: { userId, newPassword } })
      .catch(toAppError);
  }

  async revokeUserSessions(headers: Headers, userId: string): Promise<void> {
    await this.authApi
      .revokeUserSessions({ headers, body: { userId } })
      .catch(toAppError);
  }

  // D7 invariant guard: an OWNER who is the last active OWNER cannot be
  // demoted, banned, or removed (would leave the system unadministerable).
  countActiveOwners(): Promise<number> {
    return this.db.user.count({ where: { role: "OWNER", banned: { not: true } } });
  }
}
