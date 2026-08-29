/**
 * Casos de uso para EvaluationRule (reglas de conteo exacto por
 * Prueba × Grado × Asignatura × Tipo de cuadernillo).
 *
 * Patrón idéntico a `src/modules/booklet-types/application/manage-booklet-types.ts`:
 * - UseCase<Input, Output> con `execute({ actor, ... })`.
 * - `requireRole` para gating.
 * - `Result<T>` para errores legibles (nunca throw).
 * - `ValidationError`, `ConflictError`, `NotFoundError` desde shared.
 *
 * Particularidades:
 * - Crear/Editar/Eliminar → solo `ECU_MASTER`.
 * - Listar / Find → cualquiera con sesión.
 * - Validamos todas las FK (period, course, subject, bookletType opcional)
 *   contra sus repos para devolver un error legible si alguna pertenece
 *   a otra institución o no existe.
 * - La unicidad de la tupla la enforce Postgres (índice unique). Aquí
 *   hacemos un pre-check para mensaje claro y, además, capturamos P2002
 *   por si dos requests concurrentes pasan el pre-check.
 */

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
import type { BookletTypeRepository } from "@/modules/booklet-types/domain/booklet-type";
import type {
  CourseRepository,
  PeriodRepository,
  SubjectRepository,
} from "@/modules/academic/domain/types";
import type { EvaluationRepository } from "@/modules/evaluations/domain/evaluation";

import {
  type EvaluationRule,
  type EvaluationRuleRepository,
  isValidExactQuestions,
} from "../domain/evaluation-rule";

// ---------------------------------------------------------------------------
// Helper de error Prisma
// ---------------------------------------------------------------------------

/** P2002 = unique constraint violated. Detectamos aquí para no filtrar
 *  `@prisma/client` a la capa de aplicación. */
function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// CreateEvaluationRule
// ---------------------------------------------------------------------------

export interface CreateEvaluationRuleInput {
  actor: AuthenticatedUser;
  data: {
    periodId: string;
    courseId: string;
    subjectId: string;
    bookletTypeId: string;
    exactQuestions: number;
  };
}

export class CreateEvaluationRule implements UseCase<CreateEvaluationRuleInput, EvaluationRule> {
  constructor(
    private readonly rules: EvaluationRuleRepository,
    private readonly periods: PeriodRepository,
    private readonly courses: CourseRepository,
    private readonly subjects: SubjectRepository,
    private readonly bookletTypes: BookletTypeRepository,
  ) {}

  async execute({ actor, data }: CreateEvaluationRuleInput): Promise<Result<EvaluationRule>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (!isValidExactQuestions(data.exactQuestions)) {
      return fail(
        new ValidationError(
          `El conteo exacto debe ser un entero entre ${data.exactQuestions < 1 ? 1 : "el máximo"} y 500.`,
        ),
      );
    }

    // Validar FKs en orden. Mensajes claros para el docente.
    const period = await this.periods.findById(actor.institutionId, data.periodId);
    if (!period) return fail(new NotFoundError("Prueba", data.periodId));

    const course = await this.courses.findById(actor.institutionId, data.courseId);
    if (!course) return fail(new NotFoundError("Grado", data.courseId));

    const subject = await this.subjects.findById(data.subjectId);
    if (!subject) return fail(new NotFoundError("Asignatura", data.subjectId));

    if (!data.bookletTypeId) {
      return fail(new ValidationError("Falta el tipo de cuadernillo."));
    }
    const bt = await this.bookletTypes.findById(actor.institutionId, data.bookletTypeId);
    if (!bt) return fail(new NotFoundError("Tipo de cuadernillo", data.bookletTypeId));
    // El bookletType debe pertenecer a la misma Prueba de la regla. Si
    // pertenece a otra Prueba, la regla quedaría inalcanzable (ninguna
    // evaluación puede tener ambos periodos distintos a la vez).
    if (bt.periodId !== data.periodId) {
      return fail(
        new ValidationError("El tipo de cuadernillo no pertenece a la prueba seleccionada."),
      );
    }

    // Pre-check de unicidad de la tupla (mensaje más claro que dejar
    // que Postgres lo rechace).
    const siblings = await this.rules.listByPeriod(actor.institutionId, data.periodId);
    const duplicate = siblings.find(
      (r) =>
        r.courseId === data.courseId &&
        r.subjectId === data.subjectId &&
        r.bookletTypeId === data.bookletTypeId,
    );
    if (duplicate) {
      return fail(
        new ConflictError(
          "Ya existe una regla para esta combinación de grado, asignatura y tipo de cuadernillo en la prueba.",
        ),
      );
    }

    try {
      const created = await this.rules.create(actor.institutionId, {
        periodId: data.periodId,
        courseId: data.courseId,
        subjectId: data.subjectId,
        bookletTypeId: data.bookletTypeId,
        exactQuestions: data.exactQuestions,
        createdById: actor.userId,
      });
      return ok(created);
    } catch (e) {
      if (isPrismaUniqueConstraintError(e)) {
        return fail(
          new ConflictError(
            "Ya existe una regla para esta combinación de grado, asignatura y tipo de cuadernillo en la prueba.",
          ),
        );
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// ListEvaluationRulesByPeriod
// ---------------------------------------------------------------------------

export interface ListEvaluationRulesByPeriodInput {
  actor: AuthenticatedUser;
  periodId: string;
}

export class ListEvaluationRulesByPeriod implements UseCase<
  ListEvaluationRulesByPeriodInput,
  EvaluationRule[]
> {
  constructor(private readonly rules: EvaluationRuleRepository) {}

  async execute({
    actor,
    periodId,
  }: ListEvaluationRulesByPeriodInput): Promise<Result<EvaluationRule[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const list = await this.rules.listByPeriod(actor.institutionId, periodId);
    return ok(list);
  }
}

// ---------------------------------------------------------------------------
// ListEvaluationRulesByInstitution
// ---------------------------------------------------------------------------

export interface ListEvaluationRulesByInstitutionInput {
  actor: AuthenticatedUser;
}

export class ListEvaluationRulesByInstitution implements UseCase<
  ListEvaluationRulesByInstitutionInput,
  EvaluationRule[]
> {
  constructor(private readonly rules: EvaluationRuleRepository) {}

  async execute({
    actor,
  }: ListEvaluationRulesByInstitutionInput): Promise<Result<EvaluationRule[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const list = await this.rules.listByInstitution(actor.institutionId);
    return ok(list);
  }
}

// ---------------------------------------------------------------------------
// UpdateEvaluationRule
// ---------------------------------------------------------------------------

export interface UpdateEvaluationRuleInput {
  actor: AuthenticatedUser;
  id: string;
  data: {
    exactQuestions?: number;
  };
}

export class UpdateEvaluationRule implements UseCase<UpdateEvaluationRuleInput, EvaluationRule> {
  constructor(private readonly rules: EvaluationRuleRepository) {}

  async execute({ actor, id, data }: UpdateEvaluationRuleInput): Promise<Result<EvaluationRule>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (data.exactQuestions !== undefined && !isValidExactQuestions(data.exactQuestions)) {
      return fail(new ValidationError("El conteo exacto debe ser un entero entre 1 y 500."));
    }

    const existing = await this.rules.findById(actor.institutionId, id);
    if (!existing) return fail(new NotFoundError("Regla de evaluación", id));

    const updated = await this.rules.update(actor.institutionId, id, data);
    if (!updated) return fail(new NotFoundError("Regla de evaluación", id));
    return ok(updated);
  }
}

// ---------------------------------------------------------------------------
// DeleteEvaluationRule
// ---------------------------------------------------------------------------

export interface DeleteEvaluationRuleInput {
  actor: AuthenticatedUser;
  id: string;
}

export class DeleteEvaluationRule implements UseCase<DeleteEvaluationRuleInput, void> {
  constructor(private readonly rules: EvaluationRuleRepository) {}

  async execute({ actor, id }: DeleteEvaluationRuleInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const existing = await this.rules.findById(actor.institutionId, id);
    if (!existing) return fail(new NotFoundError("Regla de evaluación", id));

    await this.rules.delete(actor.institutionId, id);
    return ok(undefined);
  }
}

// ---------------------------------------------------------------------------
// FindRuleForEvaluation
// ---------------------------------------------------------------------------

export interface FindRuleForEvaluationInput {
  actor: AuthenticatedUser;
  evaluationId: string;
}

/**
 * Resuelve la regla aplicable a una evaluación, si existe.
 *
 * - Carga la evaluación (acotada por institución).
 * - Delega en `EvaluationRuleRepository.findForEvaluation`, que ya
 *   resuelve `courseSubjectId → {courseId, subjectId}` y matchea la tupla.
 * - Devuelve `ok(null)` cuando no hay regla (modo libre).
 */
export class FindRuleForEvaluation implements UseCase<
  FindRuleForEvaluationInput,
  EvaluationRule | null
> {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly rules: EvaluationRuleRepository,
  ) {}

  async execute({
    actor,
    evaluationId,
  }: FindRuleForEvaluationInput): Promise<Result<EvaluationRule | null>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const evaluation = await this.evaluations.findById(actor.institutionId, evaluationId);
    if (!evaluation) return fail(new NotFoundError("Formulación", evaluationId));

    const rule = await this.rules.findForEvaluation(
      actor.institutionId,
      evaluation.courseSubjectId,
      evaluation.periodId,
      evaluation.bookletTypeId,
    );
    return ok(rule);
  }
}
