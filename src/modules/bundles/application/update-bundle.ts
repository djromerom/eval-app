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
import type { CourseRepository } from "@/modules/academic/domain/types";
import { type Bundle, type BundleRepository, type UpdateBundleData } from "../domain/bundle";
import { isLocked } from "../domain/bundle-status";
import {
  evaluationMatchesBundleCourse,
  isValidBookletNumber,
  isValidBundleName,
} from "../domain/bundle-rules";

export interface UpdateBundleInput {
  actor: AuthenticatedUser;
  bundleId: string;
  data: UpdateBundleData;
}

/**
 * Edita metadatos del bundle (nombre, bookletNumber, courseId, theme).
 * Solo SUPER_ADMIN. Solo si el bundle está en DRAFT.
 *
 * Sprint 9 — asignar/cambiar `courseId`:
 *   - El curso debe existir en la institución.
 *   - Si el compendio ya tiene items, TODOS deben ser de ese curso; si
 *     alguno no coincide se rechaza (hay que quitarlos primero). Esto
 *     mantiene la invariante "bundle con curso ⇒ items homogéneos".
 *   - `courseId: null` limpia el curso (vuelve a cross-course) sin
 *     validar los items: relajar la restricción siempre es seguro.
 */
export class UpdateBundle implements UseCase<UpdateBundleInput, Bundle> {
  constructor(
    private readonly bundles: BundleRepository,
    private readonly courses: CourseRepository,
  ) {}

  async execute({ actor, bundleId, data }: UpdateBundleInput): Promise<Result<Bundle>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const existing = await this.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Compendio", bundleId));

    if (isLocked(existing.status)) {
      return fail(
        new ValidationError("El compendio está sellado (READY). Desmárcate primero para editarlo."),
      );
    }

    if (data.name !== undefined && !isValidBundleName(data.name)) {
      return fail(
        new ValidationError("El nombre del compendio debe tener entre 3 y 120 caracteres."),
      );
    }
    if (data.bookletNumber !== undefined && !isValidBookletNumber(data.bookletNumber)) {
      return fail(new ValidationError("El número de cuadernillo debe ser un entero positivo."));
    }

    // bookletNumber único
    if (data.bookletNumber !== undefined && data.bookletNumber !== null) {
      const all = await this.bundles.findAll(actor.institutionId);
      const clash = all.find((b) => b.bookletNumber === data.bookletNumber && b.id !== bundleId);
      if (clash) {
        return fail(
          new ConflictError(
            `Ya existe un compendio con el número de cuadernillo ${data.bookletNumber}.`,
          ),
        );
      }
    }

    // Asignar/cambiar curso: valida existencia y homogeneidad de los items.
    if (data.courseId !== undefined && data.courseId !== null) {
      const course = await this.courses.findById(actor.institutionId, data.courseId);
      if (!course) {
        return fail(new ValidationError("El curso no existe en tu institución."));
      }

      const items = await this.bundles.listItemsOrdered(bundleId);
      const mismatch = items.find(
        (i) => !evaluationMatchesBundleCourse(data.courseId!, i.courseId),
      );
      if (mismatch) {
        return fail(
          new ValidationError(
            `No puedes asignar el curso ${course.name}: el compendio ya tiene items de otros cursos (p. ej. "${mismatch.evaluationTitle}" es de ${mismatch.courseName}). Quítalos primero.`,
          ),
        );
      }
    }

    const updated = await this.bundles.update(actor.institutionId, bundleId, data);
    return ok(updated);
  }
}
