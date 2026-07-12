import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, fail, ok } from "@/shared/domain/result";
import type { Institution, InstitutionRepository } from "../domain/institution";

export interface GetMyInstitutionInput {
  actor: AuthenticatedUser;
}

/** Lee la institución del actor (cualquier rol autenticado). Usada por impresión/branding. */
export class GetMyInstitution implements UseCase<GetMyInstitutionInput, Institution> {
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute({ actor }: GetMyInstitutionInput): Promise<Result<Institution>> {
    const institution = await this.institutions.findById(actor.institutionId);
    if (!institution) return fail(new NotFoundError("Institución", actor.institutionId));
    return ok(institution);
  }
}
