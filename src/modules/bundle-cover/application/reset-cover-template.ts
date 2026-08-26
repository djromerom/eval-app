/**
 * Caso de uso: restablecer el built-in de la variante actual del bundle.
 *
 * Borra el body override (coverTemplateBody = null) sin cambiar la key.
 * Después del reset, `state.source === "BUILT_IN"` y el render usa
 * templates/cover/{key}.html directamente.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import { type CoverTemplateRepository, type CoverTemplateState } from "../domain/cover-template";

export interface ResetCoverTemplateInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

export class ResetCoverTemplate implements UseCase<ResetCoverTemplateInput, CoverTemplateState> {
  constructor(private readonly states: CoverTemplateRepository) {}

  async execute({ actor, bundleId }: ResetCoverTemplateInput): Promise<Result<CoverTemplateState>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const state = await this.states.resetOverride(actor.institutionId, bundleId);
    return ok(state);
  }
}
