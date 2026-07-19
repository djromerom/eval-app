import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type Bundle, type BundleRepository } from "../domain/bundle";
import { canTransition } from "../domain/bundle-status";

export interface UnmarkBundleReadyInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

/**
 * Desmarca el bundle: READY → DRAFT. Solo SUPER_ADMIN.
 *
 * Sprint 1 deja esta use case disponible para uso administrativo
 * (corrección de errores en el contenido antes de imprimir masivamente).
 * La UI del Sprint 1 no expone esta acción; queda como preparación para
 * el Sprint 3.
 */
export class UnmarkBundleReady implements UseCase<UnmarkBundleReadyInput, Bundle> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor, bundleId }: UnmarkBundleReadyInput): Promise<Result<Bundle>> {
    const authorized = requireRole(actor, "SUPER_ADMIN");
    if (!authorized.ok) return authorized;

    const bundle = await this.bundles.findById(actor.institutionId, bundleId);
    if (!bundle) return fail(new NotFoundError("Compendio", bundleId));

    if (!canTransition(bundle.status, "DRAFT")) {
      return fail(
        new ValidationError(
          `El compendio está en estado ${bundle.status}; solo se puede desmarcar desde READY.`,
        ),
      );
    }

    await this.bundles.setStatus(actor.institutionId, bundleId, "DRAFT");
    return ok({ ...bundle, status: "DRAFT" });
  }
}
