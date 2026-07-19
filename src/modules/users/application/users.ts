import {
  type AuthenticatedUser,
  type Role,
  requireRole,
} from "@/shared/application/authenticated-user";
import type { EmailService } from "@/shared/domain/email";
import { sendUserInvitation } from "@/shared/application/user-invitation";
import { logger } from "@/shared/infrastructure/logger";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type User, type UserRepository, areAssignableRoles, isValidEmail } from "../domain/user";

export interface InviteUserInput {
  actor: AuthenticatedUser;
  email: string;
  name: string;
  roles: Role[];
  institutionName?: string;
  /** Solo SUPER_ADMIN: permite invitar a una institución distinta de la
   *  suya. Si se envía y el actor NO es SUPER_ADMIN, se ignora (se usa
   *  `actor.institutionId` por seguridad). Si SUPER_ADMIN lo envía, debe
   *  apuntar a una institución existente. */
  targetInstitutionId?: string;
}

/**
 * Invita a un usuario a la institución del ADMIN con uno o más roles
 * combinables (§2, §3.1). Queda inactivo hasta que vincule cuenta OAuth o
 * defina contraseña; se le envía el correo con el enlace de invitación.
 *
 * Cross-institución: si el actor es SUPER_ADMIN y envía `targetInstitutionId`,
 * el usuario se crea en esa institución en lugar de la del actor. Útil para
 * dar de alta admins en instituciones nuevas sin tener que impersonar.
 */
export class InviteUser implements UseCase<InviteUserInput, User> {
  constructor(
    private readonly users: UserRepository,
    private readonly institutions?: {
      findById: (id: string) => Promise<{ id: string; name: string } | null>;
    },
    private readonly email?: EmailService,
  ) {}

  async execute({
    actor,
    email,
    name,
    roles,
    institutionName,
    targetInstitutionId,
  }: InviteUserInput): Promise<Result<User>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN");
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

    // Resolver institución destino:
    // - SUPER_ADMIN puede pasar `targetInstitutionId` para cross-institución.
    //   Si lo pasa y la institución no existe → error de validación.
    // - Cualquier actor (ECU_MASTER o SUPER_ADMIN sin target) cae a la suya.
    let resolvedInstitutionId = actor.institutionId;
    let resolvedInstitutionName = institutionName;
    if (targetInstitutionId && targetInstitutionId !== actor.institutionId) {
      if (!actor.roles.includes("SUPER_ADMIN")) {
        return fail(
          new ValidationError("Solo un SUPER_ADMIN puede invitar usuarios a otra institución."),
        );
      }
      if (!this.institutions) {
        return fail(
          new ValidationError("Falta el repositorio de instituciones para cross-institución."),
        );
      }
      const target = await this.institutions.findById(targetInstitutionId);
      if (!target) {
        return fail(new ValidationError("La institución seleccionada no existe."));
      }
      resolvedInstitutionId = target.id;
      resolvedInstitutionName = target.name;
    }

    const user = await this.users.invite(
      resolvedInstitutionId,
      email.toLowerCase(),
      name.trim(),
      roles,
    );

    if (this.email) {
      try {
        await sendUserInvitation(
          this.email,
          (userId, tokenHash, expiresAt) => this.users.setInviteToken(userId, tokenHash, expiresAt),
          {
            userId: user.id,
            email: user.email,
            name: user.name,
            institutionName: resolvedInstitutionName ?? "Institución",
          },
        );
      } catch (error) {
        // El usuario se creó igual; el correo se puede reintentar.
        logger.error(
          { err: error, userId: user.id, to: user.email },
          "No se pudo enviar el correo de invitación al usuario",
        );
      }
    }

    return ok(user);
  }
}

export interface ResendUserInvitationInput {
  actor: AuthenticatedUser;
  userId: string;
  institutionName?: string;
}

/** Reenvía el correo de invitación a un usuario que aún no ha activado su cuenta. §3.1 */
export class ResendUserInvitation implements UseCase<ResendUserInvitationInput, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly email?: EmailService,
  ) {}

  async execute({
    actor,
    userId,
    institutionName,
  }: ResendUserInvitationInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (!this.email) {
      return fail(new ValidationError("El envío de correos no está configurado (SMTP)."));
    }

    const user = await this.users.findById(actor.institutionId, userId);
    if (!user) return fail(new ValidationError("El usuario no existe en tu institución."));
    if (user.isActive) {
      return fail(new ValidationError("El usuario ya activó su cuenta; no requiere invitación."));
    }

    try {
      await sendUserInvitation(
        this.email,
        (uid, tokenHash, expiresAt) => this.users.setInviteToken(uid, tokenHash, expiresAt),
        {
          userId: user.id,
          email: user.email,
          name: user.name,
          institutionName: institutionName ?? "Institución",
        },
      );
    } catch (error) {
      logger.error(
        { err: error, userId: user.id, to: user.email },
        "No se pudo reenviar el correo de invitación al usuario",
      );
      return fail(
        new ValidationError(
          "No se pudo enviar el correo. Verifica la configuración SMTP e inténtalo de nuevo.",
        ),
      );
    }

    return ok(undefined);
  }
}

export interface ListUsersInput {
  actor: AuthenticatedUser;
}

export class ListUsers implements UseCase<ListUsersInput, User[]> {
  constructor(private readonly users: UserRepository) {}

  async execute({ actor }: ListUsersInput): Promise<Result<User[]>> {
    const authorized = requireRole(actor, "ECU_MASTER");
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
    const authorized = requireRole(actor, "ECU_MASTER");
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
    const authorized = requireRole(actor, "ECU_MASTER");
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
