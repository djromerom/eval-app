import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, fail, ok } from "@/shared/domain/result";
import type { Institution, InstitutionRepository } from "../domain/institution";

export interface SetInstitutionActiveInput {
  actor: AuthenticatedUser;
  id: string;
  isActive: boolean;
}

/**
 * Caso de uso: activar o desactivar una institución (solo SUPER_ADMIN).
 * Ver REQUERIMIENTOS_v2.md §2 (SUPER_ADMIN: crear, activar, desactivar).
 */
export class SetInstitutionActive implements UseCase<SetInstitutionActiveInput, Institution> {
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute({ actor, id, isActive }: SetInstitutionActiveInput): Promise<Result<Institution>> {
    const authorized = requireRole(actor, "SUPER_ADMIN");
    if (!authorized.ok) return authorized;

    const institution = await this.institutions.findById(id);
    if (!institution) return fail(new NotFoundError("Institución", id));

    if (institution.isActive !== isActive) {
      await this.institutions.setActive(id, isActive);
    }
    return ok({ ...institution, isActive });
  }
}
