import { BusinessRuleError } from "../../lib/errors";
import { AsyncMutex } from "../../lib/mutex";
import { PrismaUserRepository } from "./user.repository";
import {
  validateCreateUserInput,
  validatePasswordResetInput,
  validateUpdateUserInput,
} from "./user.validation";
import type { UserAdminView } from "./user.types";

const INTERNAL_EMAIL_DOMAIN = "erp.local";

// Serializes the last-active-OWNER guard with its mutation (P4). Better Auth
// performs the write in its own transaction, so the read-then-write race can
// only be closed by serializing the critical section in-process.
const ownerGuardMutex = new AsyncMutex();

export class UserService {
  constructor(private readonly repository = new PrismaUserRepository()) {}

  async listUsers(headers: Headers): Promise<UserAdminView[]> {
    return this.repository.listUsers(headers);
  }

  async createUser(headers: Headers, body: unknown): Promise<UserAdminView> {
    const input = validateCreateUserInput(body);
    return this.repository.createUser(headers, {
      email: `${input.username}@${INTERNAL_EMAIL_DOMAIN}`,
      name: input.username,
      username: input.username,
      password: input.password,
      role: input.role,
    });
  }

  async findUserById(headers: Headers, id: string): Promise<UserAdminView> {
    return this.repository.findUserById(headers, id);
  }

  async updateRole(headers: Headers, id: string, body: unknown): Promise<UserAdminView> {
    const input = validateUpdateUserInput(body);
    return ownerGuardMutex.runExclusive(async () => {
      const target = await this.repository.findUserById(headers, id);
      if (target.role === "OWNER" && input.role !== "OWNER") {
        await this.assertNotLastActiveOwner(target);
      }
      return this.repository.updateRole(headers, id, input.role);
    });
  }

  async deleteUser(headers: Headers, id: string): Promise<void> {
    return ownerGuardMutex.runExclusive(async () => {
      const target = await this.repository.findUserById(headers, id);
      if (target.role === "OWNER") {
        await this.assertNotLastActiveOwner(target);
      }
      await this.repository.remove(headers, id);
    });
  }

  async banUser(headers: Headers, id: string): Promise<UserAdminView> {
    return ownerGuardMutex.runExclusive(async () => {
      const target = await this.repository.findUserById(headers, id);
      if (target.role === "OWNER") {
        await this.assertNotLastActiveOwner(target);
      }
      return this.repository.ban(headers, id);
    });
  }

  async unbanUser(headers: Headers, id: string): Promise<UserAdminView> {
    await this.repository.findUserById(headers, id);
    return this.repository.unban(headers, id);
  }

  // D9.5: password reset also revokes all of the user's sessions.
  async resetPassword(headers: Headers, id: string, body: unknown): Promise<void> {
    const input = validatePasswordResetInput(body);
    await this.repository.findUserById(headers, id);
    await this.repository.setPassword(headers, id, input.newPassword);
    await this.repository.revokeUserSessions(headers, id);
  }

  // D7 invariant: never leave the system with zero active OWNERs. Only enforced
  // when the target is currently active (a banned OWNER does not contribute to
  // the active-OWNER count).
  private async assertNotLastActiveOwner(target: UserAdminView): Promise<void> {
    if (target.banned) return;
    const activeOwners = await this.repository.countActiveOwners();
    if (activeOwners <= 1) {
      throw new BusinessRuleError("Cannot modify the last active OWNER");
    }
  }
}
