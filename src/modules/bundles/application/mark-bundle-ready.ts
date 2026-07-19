import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type Bundle, type BundleRepository } from "../domain/bundle";
import { canTransition } from "../domain/bundle-status";
import { MIN_ITEMS_FOR_READY, isPrintableEvaluationStatus } from "../domain/bundle-rules";

export interface MarkBundleReadyInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

/**
 * Sella el bundle: DRAFT → READY. Solo SUPER_ADMIN.
 * Validaciones:
 *   - Bundle existe.
 *   - Status = DRAFT.
 *   - Al menos 1 item.
 *   - Todas las evaluations siguen en {APPROVED, PUBLISHED} (no volvieron
 *     a DRAFT por edición).
 *   - Cada item tiene totalQuestions > 0.
 *
 * Una vez READY, el contenido es inmutable (no se pueden editar items,
 * nombre, bookletNumber, theme). Sí se puede regenerar el PDF.
 */
export class MarkBundleReady implements UseCase<MarkBundleReadyInput, Bundle> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor, bundleId }: MarkBundleReadyInput): Promise<Result<Bundle>> {
    const authorized = requireRole(actor, "SUPER_ADMIN");
    if (!authorized.ok) return authorized;

    const bundle = await this.bundles.findById(actor.institutionId, bundleId);
    if (!bundle) return fail(new NotFoundError("Compendio", bundleId));

    if (!canTransition(bundle.status, "READY")) {
      return fail(
        new ValidationError(
          `El compendio está en estado ${bundle.status}; no se puede marcar como READY.`,
        ),
      );
    }

    const items = await this.bundles.listItemsOrdered(bundleId);
    if (items.length < MIN_ITEMS_FOR_READY) {
      return fail(
        new ValidationError(
          `El compendio debe tener al menos ${MIN_ITEMS_FOR_READY} evaluación para marcarse como READY.`,
        ),
      );
    }

    // Re-validar que todas las evaluations siguen printable. Cubre el caso
    // donde una evaluation volvió a DRAFT por edición.
    const evaluationIds = items.map((i) => i.evaluationId);
    const evaluations = await this.bundles.findEvaluationsByIds(actor.institutionId, evaluationIds);
    for (const ev of evaluations) {
      if (!isPrintableEvaluationStatus(ev.status)) {
        return fail(
          new ValidationError(
            `La evaluación "${ev.title}" ya no está aprobada o publicada (ahora: ${ev.status}). Quítala del compendio antes de marcar como READY.`,
          ),
        );
      }
      if (ev.totalQuestions === 0) {
        return fail(
          new ValidationError(
            `La evaluación "${ev.title}" no tiene preguntas. Añade al menos una antes de marcar como READY.`,
          ),
        );
      }
    }

    await this.bundles.setStatus(actor.institutionId, bundleId, "READY");
    return ok({ ...bundle, status: "READY" });
  }
}
