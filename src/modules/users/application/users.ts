import {
  type AuthenticatedUser,
  type Role,
  requireRole,
} from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type User, type UserRepository, areAssignableRoles, isValidEmail } from "../domain/user";

export interface InviteUserInput {
  actor: AuthenticatedUser;
  email: string;
  name: string;
  roles: Role[];
}

/**
 * Invita a un usuario a la institución del ADMIN con uno o más roles
 * combinables (§2, §3.1). Queda inactivo hasta que vincule cuenta OAuth o
 * defina contraseña.
 */
export class InviteUser implements UseCase<InviteUserInput, User> {
  constructor(private readonly users: UserRepository) {}

  async execute({ actor, email, name, roles }: InviteUserInput): Promise<Result<User>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!name.trim()) return fail(new ValidationError("El nombre es obligatorio."));
    if (!isValidEmail(email)) return fail(new ValidationError("Correo electrónico inválido."));
    if (!areAssignableRoles(roles)) {
      return fail(
        new ValidationError("Selecciona al menos un rol válido (ADMIN, COORDINADOR o PROFESOR)."),
      );
    }
    if (await this.users.findByEmail(email)) {
      return fail(new ValidationError(`Ya existe un usuario con el correo "${email}".`));
    }

    return ok(
      await this.users.invite(actor.institutionId, email.toLowerCase(), name.trim(), roles),
    );
  }
}

export interface ListUsersInput {
  actor: AuthenticatedUser;
}

export class ListUsers implements UseCase<ListUsersInput, User[]> {
  constructor(private readonly users: UserRepository) {}

  async execute({ actor }: ListUsersInput): Promise<Result<User[]>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.users.findAll(actor.institutionId));
  }
}

export interface SetUserRolesInput {
  actor: AuthenticatedUser;
  userId: string;
  roles: Role[];
}

export class SetUserRoles implements UseCase<SetUserRolesInput, User> {
  constructor(private readonly users: UserRepository) {}

  async execute({ actor, userId, roles }: SetUserRolesInput): Promise<Result<User>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!areAssignableRoles(roles)) {
      return fail(new ValidationError("Debes asignar al menos un rol válido."));
    }
    const user = await this.users.findById(actor.institutionId, userId);
    if (!user) return fail(new ValidationError("El usuario no existe en tu institución."));

    await this.users.setRoles(actor.institutionId, userId, roles);
    return ok({ ...user, roles });
  }
}

export interface SetUserActiveInput {
  actor: AuthenticatedUser;
  userId: string;
  isActive: boolean;
}

export class SetUserActive implements UseCase<SetUserActiveInput, User> {
  constructor(private readonly users: UserRepository) {}

  async execute({ actor, userId, isActive }: SetUserActiveInput): Promise<Result<User>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (userId === actor.userId) {
      return fail(new ValidationError("No puedes desactivar tu propia cuenta."));
    }
    const user = await this.users.findById(actor.institutionId, userId);
    if (!user) return fail(new ValidationError("El usuario no existe en tu institución."));

    await this.users.setActive(actor.institutionId, userId, isActive);
    return ok({ ...user, isActive });
  }
}
