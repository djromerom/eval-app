import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type CreateInstitutionData,
  type Institution,
  type InstitutionRepository,
  isValidSlug,
} from "../domain/institution";

export interface CreateInstitutionInput {
  actor: AuthenticatedUser;
  data: CreateInstitutionData;
}

/**
 * Caso de uso: registrar una institución (solo SUPER_ADMIN).
 * Ver REQUERIMIENTOS_v2.md §2 y §6.1.
 */
export class CreateInstitution implements UseCase<CreateInstitutionInput, Institution> {
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute({ actor, data }: CreateInstitutionInput): Promise<Result<Institution>> {
    const authorized = requireRole(actor, "SUPER_ADMIN");
    if (!authorized.ok) return authorized;

    if (!isValidSlug(data.slug)) {
      return fail(
        new ValidationError(
          "El slug debe tener entre 3 y 40 caracteres, solo minúsculas, números y guiones",
        ),
      );
    }

    if (await this.institutions.findBySlug(data.slug)) {
      return fail(new ValidationError(`Ya existe una institución con el slug "${data.slug}"`));
    }
    if (await this.institutions.findByCode(data.code)) {
      return fail(new ValidationError(`Ya existe una institución con el código "${data.code}"`));
    }

    const institution = await this.institutions.create(data);
    return ok(institution);
  }
}
