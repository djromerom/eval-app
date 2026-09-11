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
import type {
  CourseRepository,
  PeriodRepository,
} from "@/modules/academic/domain/types";
import type { BookletTypeRepository } from "@/modules/booklet-types/domain/booklet-type";
import { type Bundle, type BundleRepository, type UpdateBundleData } from "../domain/bundle";
import { isLocked } from "../domain/bundle-status";
import {
  evaluationMatchesBundleBookletType,
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
 *   - Si el cuadernillo ya tiene items, TODOS deben ser de ese curso; si
 *     alguno no coincide se rechaza (hay que quitarlos primero). Esto
 *     mantiene la invariante "bundle con curso ⇒ items homogéneos".
 *   - `courseId: null` limpia el curso (vuelve a cross-course) sin
 *     validar los items: relajar la restricción siempre es seguro.
 *
 * Sprint Bundle-Period (sep 2026) — asignar/cambiar `periodId` /
 * `bookletTypeId`: misma semántica que `courseId`: validar existencia y
 * consistencia con los items existentes; `null` explícito relaja la
 * restricción sin validar items.
 */
export class UpdateBundle implements UseCase<UpdateBundleInput, Bundle> {
  constructor(
    private readonly bundles: BundleRepository,
    private readonly courses: CourseRepository,
    private readonly periods: PeriodRepository,
    private readonly bookletTypes: BookletTypeRepository,
  ) {}

  async execute({ actor, bundleId, data }: UpdateBundleInput): Promise<Result<Bundle>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const existing = await this.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Cuadernillo", bundleId));

    if (isLocked(existing.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para editarlo.",
        ),
      );
    }

    if (data.name !== undefined && !isValidBundleName(data.name)) {
      return fail(
        new ValidationError("El nombre del cuadernillo debe tener entre 3 y 120 caracteres."),
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
            `Ya existe un cuadernillo con el número de cuadernillo ${data.bookletNumber}.`,
          ),
        );
      }
    }

    // Asignar/cambiar curso: valida existencia y homogeneidad de los items.
    if (data.courseId !== undefined && data.courseId !== null) {
      const course = await this.courses.findById(actor.institutionId, data.courseId);
      if (!course) {
        return fail(new ValidationError("El grado no existe en tu institución."));
      }

      const items = await this.bundles.listItemsOrdered(bundleId);
      const mismatch = items.find(
        (i) => !evaluationMatchesBundleCourse(data.courseId!, i.courseId),
      );
      if (mismatch) {
        return fail(
          new ValidationError(
            `No puedes asignar el curso ${course.name}: el cuadernillo ya tiene items de otros cursos (p. ej. "${mismatch.evaluationTitle}" es de ${mismatch.courseName}). Quítalos primero.`,
          ),
        );
      }
    }

    // Sprint Bundle-Period — periodId / bookletTypeId.
    // Resolvemos los valores FINALES (input gana sobre existing) y validamos
    // existencia + consistencia con los items.
    const finalPeriodId: string | null =
      data.periodId !== undefined ? data.periodId : existing.periodId;
    const finalBookletTypeId: string | null =
      data.bookletTypeId !== undefined ? data.bookletTypeId : existing.bookletTypeId;

    if (data.periodId !== undefined && data.periodId !== null) {
      const period = await this.periods.findById(actor.institutionId, data.periodId);
      if (!period) {
        return fail(new ValidationError("La Prueba no existe en tu institución."));
      }
    }

    if (data.bookletTypeId !== undefined && data.bookletTypeId !== null) {
      const bt = await this.bookletTypes.findById(actor.institutionId, data.bookletTypeId);
      if (!bt) {
        return fail(new ValidationError("El tipo de cuadernillo no existe en tu institución."));
      }
      if (finalPeriodId !== null && bt.periodId !== finalPeriodId) {
        return fail(
          new ValidationError("El tipo de cuadernillo no pertenece a la Prueba del cuadernillo."),
        );
      }
      // Consistencia con los items: si el cuadernillo pasa a tener
      // bookletTypeId, todos los items deben matchear.
      const items = await this.bundles.listItemsOrdered(bundleId);
      const mismatch = items.find(
        (i) => !evaluationMatchesBundleBookletType(finalBookletTypeId, i.bookletTypeId),
      );
      if (mismatch) {
        return fail(
          new ValidationError(
            `No puedes asignar el tipo "${bt.name}": el cuadernillo ya tiene items de otro tipo (p. ej. "${mismatch.evaluationTitle}" es de ${mismatch.bookletTypeName ?? "(sin tipo)"}). Quítalos primero.`,
          ),
        );
      }
    }

    const updated = await this.bundles.update(actor.institutionId, bundleId, data);
    return ok(updated);
  }
}
