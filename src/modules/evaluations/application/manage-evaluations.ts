import {
  type AuthenticatedUser,
  hasRole,
  requireRole,
} from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { CourseSubjectRepository, PeriodRepository } from "@/modules/academic/domain/types";
import type { EvaluationStatus } from "../domain/evaluation-status";
import {
  type CreateEvaluationData,
  type CreateQuestionData,
  type CreateSectionData,
  type Evaluation,
  type EvaluationDetail,
  type EvaluationListItem,
  type EvaluationRepository,
  type EvaluationSection,
  type Question,
  type UpdateEvaluationSettingsData,
  validateDurationMinutes,
  validateQuestionShape,
} from "../domain/evaluation";

export interface CreateEvaluationInput {
  actor: AuthenticatedUser;
  data: CreateEvaluationData;
}

/** Crea una evaluación en BORRADOR (docente o coordinador). §3.3 */
export class CreateEvaluation implements UseCase<CreateEvaluationInput, Evaluation> {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly courseSubjects: CourseSubjectRepository,
    private readonly periods: PeriodRepository,
  ) {}

  async execute({ actor, data }: CreateEvaluationInput): Promise<Result<Evaluation>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;

    if (!data.title.trim()) return fail(new ValidationError("El título es obligatorio."));

    // Sprint 7: validar duración estimada si fue capturada al crear.
    // Si no se envía (undefined), no se persiste (queda null → heurístico).
    if (data.durationMinutes !== undefined) {
      const durationError = validateDurationMinutes(data.durationMinutes);
      if (durationError) return fail(new ValidationError(durationError));
    }

    const cs = await this.courseSubjects.findById(actor.institutionId, data.courseSubjectId);
    if (!cs) return fail(new ValidationError("La asignatura-curso no existe en tu institución."));

    if (data.periodId) {
      const period = await this.periods.findById(actor.institutionId, data.periodId);
      if (!period) return fail(new ValidationError("El periodo no existe en tu institución."));
    }

    return ok(await this.evaluations.create(actor.institutionId, actor.userId, data));
  }
}

export interface ListEvaluationsInput {
  actor: AuthenticatedUser;
  status?: EvaluationStatus;
}

/**
 * Docente ve las suyas; coordinador/admin ven todas las de la institución
 * (opcionalmente filtradas por estado).
 */
export class ListEvaluations implements UseCase<ListEvaluationsInput, EvaluationListItem[]> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({ actor, status }: ListEvaluationsInput): Promise<Result<EvaluationListItem[]>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR", "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (hasRole(actor, "COORDINATOR", "ECU_MASTER")) {
      return ok(await this.evaluations.findByInstitution(actor.institutionId, status));
    }
    return ok(await this.evaluations.findByTeacher(actor.institutionId, actor.userId));
  }
}

export interface GetEvaluationInput {
  actor: AuthenticatedUser;
  id: string;
}

export class GetEvaluation implements UseCase<GetEvaluationInput, EvaluationDetail> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({ actor, id }: GetEvaluationInput): Promise<Result<EvaluationDetail>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR", "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const detail = await this.evaluations.getDetail(actor.institutionId, id);
    if (!detail) return fail(new NotFoundError("Evaluación", id));

    // El docente solo ve las suyas; coordinador/admin ven todas.
    if (!hasRole(actor, "COORDINATOR", "ECU_MASTER") && detail.teacherId !== actor.userId) {
      return fail(new NotFoundError("Evaluación", id));
    }
    return ok(detail);
  }
}

// ===== Edición de contenido (solo el dueño, en BORRADOR) =====

async function loadOwnedDraft(
  evaluations: EvaluationRepository,
  actor: AuthenticatedUser,
  evaluationId: string,
): Promise<Result<Evaluation>> {
  const evaluation = await evaluations.findById(actor.institutionId, evaluationId);
  if (!evaluation) return fail(new NotFoundError("Evaluación", evaluationId));
  if (evaluation.teacherId !== actor.userId) {
    return fail(new ValidationError("Solo el autor puede editar la evaluación."));
  }
  if (evaluation.status !== "DRAFT") {
    return fail(new ValidationError("Solo se puede editar una evaluación en BORRADOR."));
  }
  return ok(evaluation);
}

export interface AddSectionInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  data: CreateSectionData;
}

export class AddSection implements UseCase<AddSectionInput, EvaluationSection> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({
    actor,
    evaluationId,
    data,
  }: AddSectionInput): Promise<Result<EvaluationSection>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;
    return ok(await this.evaluations.addSection(actor.institutionId, evaluationId, data));
  }
}

export interface AddQuestionInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  sectionId: string;
  data: CreateQuestionData;
}

export class AddQuestion implements UseCase<AddQuestionInput, Question> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({
    actor,
    evaluationId,
    sectionId,
    data,
  }: AddQuestionInput): Promise<Result<Question>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;

    const shapeError = validateQuestionShape(data);
    if (shapeError) return fail(new ValidationError(shapeError));

    return ok(
      await this.evaluations.addQuestion(actor.institutionId, evaluationId, sectionId, data),
    );
  }
}

// ===== Sprint 7 — Panel Settings (duración) =====

export interface UpdateEvaluationSettingsInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  data: UpdateEvaluationSettingsData;
}

/**
 * Edita los campos de metadata de la evaluation accesibles desde el panel
 * Settings (hoy solo `durationMinutes`).
 *
 * Reglas (Sprint 7):
 *   - Solo `TEACHER` y `COORDINATOR`.
 *   - Solo el dueño de la evaluation (o COORDINATOR/ADMIN según rol).
 *   - Solo en `DRAFT` — un APPROVED congela la duración; cambiarla requiere
 *     crear una nueva versión desde "Enviar a revisión" → rechazar primero
 *     (o vía `createNewVersion`, ver `ChangeEvaluationStatus`).
 *   - `durationMinutes` validado con `validateDurationMinutes` (1..600 o null).
 *
 * Devuelve `Evaluation` ya actualizado.
 */
export class UpdateEvaluationSettings implements UseCase<
  UpdateEvaluationSettingsInput,
  Evaluation
> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({
    actor,
    evaluationId,
    data,
  }: UpdateEvaluationSettingsInput): Promise<Result<Evaluation>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR", "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const evaluation = await this.evaluations.findById(actor.institutionId, evaluationId);
    if (!evaluation) return fail(new NotFoundError("Evaluación", evaluationId));

    // COORDINATOR/ADMIN pueden editar settings de cualquier evaluation de su
    // institución; TEACHER solo las suyas.
    const isPrivileged = hasRole(actor, "COORDINATOR", "ECU_MASTER");
    if (!isPrivileged && evaluation.teacherId !== actor.userId) {
      return fail(new NotFoundError("Evaluación", evaluationId));
    }

    if (evaluation.status !== "DRAFT") {
      return fail(
        new ValidationError(
          "Solo se puede editar la duración mientras la evaluación esté en BORRADOR.",
        ),
      );
    }

    const durationError = validateDurationMinutes(data.durationMinutes);
    if (durationError) return fail(new ValidationError(durationError));

    return ok(await this.evaluations.updateSettings(actor.institutionId, evaluationId, data));
  }
}
