/**
 * Caso de uso: restablecer el proyecto visual de portada.
 * =========================================================
 *
 * Borra `coverVisualProject` (y `coverVisualUpdatedAt`) en el bundle.
 * NO toca `coverTemplateBody` — si el bundle tenía un override HTML,
 * queda intacto. Al restablecer, el render cae al HTML override (si
 * existe) o al built-in de la key actual. Esto es coherente con el
 * `fallbackSource` que expone `CoverVisualState` al cargar.
 *
 * Permisos: manage-bundles (ECU_MASTER / ECU_LIDER).
 * Status: solo DRAFT — mismo criterio que SaveCoverVisual. Restablecer
 * es una edición como cualquier otra.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type BundleRepository } from "@/modules/bundles/domain/bundle";
import { isLocked } from "@/modules/bundles/domain/bundle-status";
import { type CoverVisualRepository, type CoverVisualState } from "../domain/cover-visual";

export interface ResetCoverVisualInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

export class ResetCoverVisual implements UseCase<ResetCoverVisualInput, CoverVisualState> {
  constructor(
    private readonly deps: {
      visualStates: CoverVisualRepository;
      bundles: BundleRepository;
    },
  ) {}

  async execute({ actor, bundleId }: ResetCoverVisualInput): Promise<Result<CoverVisualState>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const existing = await this.deps.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (isLocked(existing.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para restablecer el proyecto visual.",
        ),
      );
    }

    const state = await this.deps.visualStates.resetProject(actor.institutionId, bundleId);
    return ok(state);
  }
}
