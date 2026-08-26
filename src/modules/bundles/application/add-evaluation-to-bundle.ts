import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import {
  ConflictError,
  NotFoundError,
  type Result,
  ValidationError,
  fail,
  ok,
} from "@/shared/domain/result";
import { type AddItemInput, type BundleItem, type BundleRepository } from "../domain/bundle";
import { isLocked } from "../domain/bundle-status";
import { evaluationMatchesBundleCourse, isPrintableEvaluationStatus } from "../domain/bundle-rules";

export interface AddEvaluationToBundleInput {
  actor: AuthenticatedUser;
  bundleId: string;
  data: AddItemInput;
}

/**
 * Añade una evaluation al bundle. Solo SUPER_ADMIN. Solo si DRAFT.
 * Reglas:
 *   - evaluationId debe existir y pertenecer a la misma institución.
 *   - evaluation.status ∈ {APPROVED, PUBLISHED}.
 *   - evaluation no puede estar ya en el bundle (el repo lo enforce con
 *     @@unique([bundleId, evaluationId])).
 *   - Si el bundle tiene courseId (Sprint 9), la evaluation debe ser de
 *     ese curso. Bundle cross-course (courseId null) acepta cualquiera.
 *   - Si order no se da, se añade al final (siguiente posición libre).
 */
export class AddEvaluationToBundle implements UseCase<AddEvaluationToBundleInput, BundleItem> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({
    actor,
    bundleId,
    data,
  }: AddEvaluationToBundleInput): Promise<Result<BundleItem>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const bundle = await this.bundles.findById(actor.institutionId, bundleId);
    if (!bundle) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (isLocked(bundle.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para añadir items.",
        ),
      );
    }

    const evaluations = await this.bundles.findEvaluationsByIds(actor.institutionId, [
      data.evaluationId,
    ]);
    const ev = evaluations[0];
    if (!ev) {
      return fail(new NotFoundError("Formulación", data.evaluationId));
    }
    if (ev.institutionId !== actor.institutionId) {
      return fail(new ValidationError(`La formulación pertenece a otra institución.`));
    }
    if (!isPrintableEvaluationStatus(ev.status)) {
      return fail(
        new ValidationError(
          `La formulación "${ev.title}" debe estar aprobada o publicada (actual: ${ev.status}).`,
        ),
      );
    }
    if (!evaluationMatchesBundleCourse(bundle.courseId, ev.courseId)) {
      return fail(
        new ValidationError(
          `El cuadernillo es del curso ${bundle.courseName ?? bundle.courseId} y la formulación "${ev.title}" es del curso ${ev.courseName}.`,
        ),
      );
    }

    const existingItems = await this.bundles.listItemsOrdered(bundleId);
    if (existingItems.some((i) => i.evaluationId === data.evaluationId)) {
      return fail(new ConflictError(`La formulación "${ev.title}" ya está en el cuadernillo.`));
    }

    try {
      const item = await this.bundles.addItem(actor.institutionId, bundleId, data);
      return ok(item);
    } catch (e) {
      // La constraint @@unique([bundleId, order]) puede fallar si el caller
      // pasa un `order` que ya existe. Reintentamos al final.
      if (data.order !== undefined) {
        const item = await this.bundles.addItem(actor.institutionId, bundleId, {
          evaluationId: data.evaluationId,
        });
        return ok(item);
      }
      throw e;
    }
  }
}
