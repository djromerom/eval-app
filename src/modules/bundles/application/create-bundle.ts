import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { ConflictError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { CourseRepository } from "@/modules/academic/domain/types";
import { type Bundle, type BundleRepository, type CreateBundleData } from "../domain/bundle";
import {
  evaluationMatchesBundleCourse,
  isPrintableEvaluationStatus,
  isValidBookletNumber,
  isValidBundleName,
} from "../domain/bundle-rules";

export interface CreateBundleInput {
  actor: AuthenticatedUser;
  data: CreateBundleData;
}

/**
 * Crea un bundle en estado DRAFT. Solo SUPER_ADMIN (decisión del SPEC §"Roles
 * y permisos"). El bundle puede tener cualquier cantidad de evaluations
 * >= 1, todas en estado APPROVED o PUBLISHED, todas de la misma institución
 * del actor.
 *
 * Validaciones:
 *   - name: 3..120 chars no triviales
 *   - bookletNumber: entero positivo si está definido
 *   - evaluationIds: no vacío, sin duplicados, todas printable, misma institución
 *   - bookletNumber único por institución (constraint DB; checked antes por repo)
 *   - courseId (Sprint 9, opcional): si está definido debe existir en la
 *     institución y TODAS las evaluations deben pertenecer a ese curso.
 *     `null`/omitido = cuadernillo cross-course (simulacro multi-grado).
 */
export class CreateBundle implements UseCase<CreateBundleInput, Bundle> {
  constructor(
    private readonly bundles: BundleRepository,
    private readonly courses: CourseRepository,
  ) {}

  async execute({ actor, data }: CreateBundleInput): Promise<Result<Bundle>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    if (!isValidBundleName(data.name)) {
      return fail(
        new ValidationError("El nombre del cuadernillo debe tener entre 3 y 120 caracteres."),
      );
    }
    if (!isValidBookletNumber(data.bookletNumber ?? null)) {
      return fail(new ValidationError("El número de cuadernillo debe ser un entero positivo."));
    }
    if (!data.evaluationIds || data.evaluationIds.length === 0) {
      return fail(new ValidationError("El cuadernillo debe incluir al menos una formulación."));
    }

    // Formulaciones únicas en el input
    const uniqueIds = new Set(data.evaluationIds);
    if (uniqueIds.size !== data.evaluationIds.length) {
      return fail(new ValidationError("Hay formulaciones duplicadas en la selección."));
    }

    // Curso del cuadernillo (opcional). Si viene, debe existir en la institución.
    const courseId = data.courseId ?? null;
    if (courseId !== null) {
      const course = await this.courses.findById(actor.institutionId, courseId);
      if (!course) {
        return fail(new ValidationError("El curso no existe en tu institución."));
      }
    }

    // Cargar y validar las formulaciones
    const evaluations = await this.bundles.findEvaluationsByIds(
      actor.institutionId,
      data.evaluationIds,
    );

    if (evaluations.length !== data.evaluationIds.length) {
      const foundIds = new Set(evaluations.map((e) => e.id));
      const missing = data.evaluationIds.filter((id) => !foundIds.has(id));
      return fail(new ValidationError(`Formulaciones no encontradas: ${missing.join(", ")}`));
    }

    for (const ev of evaluations) {
      if (ev.institutionId !== actor.institutionId) {
        return fail(
          new ValidationError(`La formulación "${ev.title}" pertenece a otra institución.`),
        );
      }
      if (!isPrintableEvaluationStatus(ev.status)) {
        return fail(
          new ValidationError(
            `La formulación "${ev.title}" debe estar aprobada o publicada (actual: ${ev.status}).`,
          ),
        );
      }
      if (!evaluationMatchesBundleCourse(courseId, ev.courseId)) {
        return fail(
          new ValidationError(
            `La formulación "${ev.title}" es del curso ${ev.courseName} y no coincide con el curso del cuadernillo.`,
          ),
        );
      }
    }

    // Validar bookletNumber único
    if (data.bookletNumber !== null && data.bookletNumber !== undefined) {
      const existing = await this.bundles.findAll(actor.institutionId);
      if (existing.some((b) => b.bookletNumber === data.bookletNumber)) {
        return fail(
          new ConflictError(
            `Ya existe un cuadernillo con el número de cuadernillo ${data.bookletNumber}.`,
          ),
        );
      }
    }

    // Construir el map que el repo espera
    const evaluationsById = new Map(
      evaluations.map((e) => [
        e.id,
        {
          id: e.id,
          title: e.title,
          status: e.status,
          totalQuestions: e.totalQuestions,
          institutionId: e.institutionId,
          subjectId: e.subjectId,
          subjectName: e.subjectName,
          subjectIsArea: e.subjectIsArea,
          parentSubjectId: e.parentSubjectId,
          parentSubjectName: e.parentSubjectName,
          courseId: e.courseId,
          courseName: e.courseName,
        },
      ]),
    );

    const bundle = await this.bundles.create(
      actor.institutionId,
      actor.userId,
      data,
      evaluationsById,
    );

    return ok(bundle);
  }
}
