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
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR", "ADMIN");
    if (!authorized.ok) return authorized;

    if (hasRole(actor, "COORDINATOR", "ADMIN")) {
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
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR", "ADMIN");
    if (!authorized.ok) return authorized;

    const detail = await this.evaluations.getDetail(actor.institutionId, id);
    if (!detail) return fail(new NotFoundError("Evaluación", id));

    // El docente solo ve las suyas; coordinador/admin ven todas.
    if (!hasRole(actor, "COORDINATOR", "ADMIN") && detail.teacherId !== actor.userId) {
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
