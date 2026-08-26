/**
 * Caso de uso: restablecer el HTML live de portada.
 * ==================================================
 *
 * Borra `coverLiveProject` (y `coverLiveUpdatedAt`) en el bundle.
 * NO toca `coverTemplateBody` — al restablecer, el render cae al HTML
 * override (si existe), luego al built-in de la key.
 *
 * Permisos: manage-bundles (ECU_MASTER / ECU_LIDER).
 * Status: solo DRAFT.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type BundleRepository } from "@/modules/bundles/domain/bundle";
import { isLocked } from "@/modules/bundles/domain/bundle-status";
import { type CoverLiveRepository, type CoverLiveState } from "../domain/cover-html";

export interface ResetCoverHtmlInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

export class ResetCoverHtml implements UseCase<ResetCoverHtmlInput, CoverLiveState> {
  constructor(
    private readonly deps: {
      liveStates: CoverLiveRepository;
      bundles: BundleRepository;
    },
  ) {}

  async execute({ actor, bundleId }: ResetCoverHtmlInput): Promise<Result<CoverLiveState>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const existing = await this.deps.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (isLocked(existing.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para restablecer el HTML live.",
        ),
      );
    }

    const state = await this.deps.liveStates.resetProject(actor.institutionId, bundleId);
    return ok(state);
  }
}
