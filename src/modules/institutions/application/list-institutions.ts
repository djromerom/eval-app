import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { Institution, InstitutionRepository } from "../domain/institution";

export interface ListInstitutionsInput {
  actor: AuthenticatedUser;
}

export class ListInstitutions implements UseCase<ListInstitutionsInput, Institution[]> {
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute({ actor }: ListInstitutionsInput): Promise<Result<Institution[]>> {
    const authorized = requireRole(actor, "SUPER_ADMIN");
    if (!authorized.ok) return authorized;

    return ok(await this.institutions.findAll());
  }
}
