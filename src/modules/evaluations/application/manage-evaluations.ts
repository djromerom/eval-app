import {
  type AuthenticatedUser,
  hasRole,
  requireRole,
} from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type {
  CourseRepository,
  CourseSubjectRepository,
  PeriodRepository,
} from "@/modules/academic/domain/types";
import type { BookletTypeRepository } from "@/modules/booklet-types/domain/booklet-type";
import type { LeaderAssignmentRepository } from "@/modules/leader-assignments/domain/leader-assignment";
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
  type UpdateQuestionData,
  type UpdateSectionData,
  validateDurationMinutes,
  validateQuestionContent,
  validateQuestionShape,
} from "../domain/evaluation";

export interface CreateEvaluationInput {
  actor: AuthenticatedUser;
  data: CreateEvaluationData;
}

/** Crea una formulación en BORRADOR (docente o coordinador). §3.3
 *
 * Regla de unicidad: no pueden coexistir dos formulaciones con la misma
 * combinación `(asignatura-curso, periodo, tipo de cuadernillo, año académico)`
 * en la misma institución. Si ya existe, devolvemos `ValidationError` con un
 * mensaje claro para que el docente decida si archivar la anterior o ajustar
 * el periodo. La BD no enforce esta regla (constraint no agregado a
 * propósito — ver docstring en `existsByCourseSubjectPeriodBookletTypeYear`);
 * la validación es solo de aplicación.
 *
 * Tipos de cuadernillo ortogonales al periodo: dos formulaciones con el mismo
 * `(asignatura-curso, periodo, año)` PUEDEN coexistir si tienen bookletTypeId
 * distinto (p.ej. "Estándar" y "Especial" para la misma Prueba). Por eso la
 * regla incluye `bookletTypeId` — el docente puede crear hasta N formulaciones
 * por Prueba (una por cada tipo configurado) sin chocar con las existentes.
 * `bookletTypeId` puede ser `null` (formulaciones sin tipo asignado, ej.
 * diagnósticos), y el check de unicidad respeta la nulabilidad: `(cs, p,
 * null, ay)` y `(cs, p, btX, ay)` se tratan como claves distintas. */
export class CreateEvaluation implements UseCase<CreateEvaluationInput, Evaluation> {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly courseSubjects: CourseSubjectRepository,
    private readonly periods: PeriodRepository,
    private readonly courses: CourseRepository,
    private readonly bookletTypes: BookletTypeRepository,
  ) {}

  async execute({ actor, data }: CreateEvaluationInput): Promise<Result<Evaluation>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    if (!data.title.trim()) return fail(new ValidationError("El título es obligatorio."));

    // Sprint 7: validar duración estimada si fue capturada al crear.
    // Si no se envía (undefined), no se persiste (queda null → heurístico).
    if (data.durationMinutes !== undefined) {
      const durationError = validateDurationMinutes(data.durationMinutes);
      if (durationError) return fail(new ValidationError(durationError));
    }

    const cs = await this.courseSubjects.findById(actor.institutionId, data.courseSubjectId);
    if (!cs) return fail(new ValidationError("La asignatura-grado no existe en tu institución."));

    // Necesitamos el año académico del curso para la validación de unicidad.
    // (El repo deriva `academicYearId = courseSubject.course.academicYearId`
    // al persistir; hacemos lo mismo aquí para mantener la regla consistente.)
    const course = await this.courses.findById(actor.institutionId, cs.courseId);
    if (!course) return fail(new ValidationError("El grado no existe en tu institución."));

    if (data.periodId) {
      const period = await this.periods.findById(actor.institutionId, data.periodId);
      if (!period) return fail(new ValidationError("El periodo no existe en tu institución."));
    }

    // Validación del tipo de cuadernillo (ago 2026): si se envió, debe
    // existir, pertenecer a la misma institución y al mismo `periodId`
    // de la formulación. Esto cierra el caso "docente pega un id de tipo
    // de otra Prueba".
    if (data.bookletTypeId) {
      const bt = await this.bookletTypes.findById(actor.institutionId, data.bookletTypeId);
      if (!bt) {
        return fail(new ValidationError("El tipo de cuadernillo no existe en tu institución."));
      }
      if (data.periodId && bt.periodId !== data.periodId) {
        return fail(
          new ValidationError("El tipo de cuadernillo no pertenece a la prueba seleccionada."),
        );
      }
    }

    // Unicidad: bloquea dos formulaciones con misma (asignatura-curso, periodo,
    // tipo de cuadernillo, año). El bookletTypeId entra en la clave para que
    // un mismo docente pueda crear N formulaciones por Prueba (una por cada
    // tipo configurado), en vez de chocar con la primera que ya tenga.
    const duplicate = await this.evaluations.existsByCourseSubjectPeriodBookletTypeYear(
      actor.institutionId,
      data.courseSubjectId,
      data.periodId ?? null,
      data.bookletTypeId ?? null,
      course.academicYearId,
    );
    if (duplicate) {
      return fail(
        new ValidationError(
          data.periodId
            ? "Ya existe una formulación para esta asignatura-grado, periodo, tipo de cuadernillo y año académico."
            : "Ya existe una formulación para esta asignatura-grado, tipo de cuadernillo y año académico (sin periodo).",
        ),
      );
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
 * (opcionalmente filtradas por estado). El ECU_LIDER ve solo las de los
 * cursos donde está asignado (todas las asignaturas de esos cursos).
 */
export class ListEvaluations implements UseCase<ListEvaluationsInput, EvaluationListItem[]> {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly leaderAssignments: LeaderAssignmentRepository,
  ) {}

  async execute({ actor, status }: ListEvaluationsInput): Promise<Result<EvaluationListItem[]>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER", "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (hasRole(actor, "ECU_LIDER") && !hasRole(actor, "ECU_MASTER")) {
      // Scope filter del líder: solo cursos asignados (todas las asignaturas
      // de esos cursos). Sin asignaciones → lista vacía.
      const courseIds = await this.leaderAssignments.listAssignedCourseIds(
        actor.institutionId,
        actor.userId,
      );
      return ok(await this.evaluations.findByCourseIds(actor.institutionId, courseIds, status));
    }
    if (hasRole(actor, "ECU_MASTER")) {
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
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER", "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const detail = await this.evaluations.getDetail(actor.institutionId, id);
    if (!detail) return fail(new NotFoundError("Formulación", id));

    // El docente solo ve las suyas; coordinador/admin ven todas.
    if (!hasRole(actor, "ECU_LIDER", "ECU_MASTER") && detail.teacherId !== actor.userId) {
      return fail(new NotFoundError("Formulación", id));
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
  if (!evaluation) return fail(new NotFoundError("Formulación", evaluationId));
  if (evaluation.teacherId !== actor.userId) {
    return fail(new ValidationError("Solo el autor puede editar la formulación."));
  }
  if (evaluation.status !== "DRAFT") {
    return fail(new ValidationError("Solo se puede editar una formulación en BORRADOR."));
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
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;
    return ok(await this.evaluations.addSection(actor.institutionId, evaluationId, data));
  }
}

export interface UpdateSectionInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  sectionId: string;
  data: UpdateSectionData;
}

/** Edita título y/o contenido de un contexto. Solo el autor y solo en DRAFT. */
export class UpdateSection implements UseCase<UpdateSectionInput, EvaluationSection> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({
    actor,
    evaluationId,
    sectionId,
    data,
  }: UpdateSectionInput): Promise<Result<EvaluationSection>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;
    return ok(
      await this.evaluations.updateSection(actor.institutionId, evaluationId, sectionId, data),
    );
  }
}

export interface DeleteSectionInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  sectionId: string;
}

/**
 * Elimina un contexto con TODAS sus preguntas. El repositorio renumera las
 * restantes; quien llame debe advertir al docente si el contexto no está
 * vacío (la UI lo hace en el diálogo de confirmación).
 */
export class DeleteSection implements UseCase<DeleteSectionInput, void> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({ actor, evaluationId, sectionId }: DeleteSectionInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;
    await this.evaluations.deleteSection(actor.institutionId, evaluationId, sectionId);
    return ok(undefined);
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
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;

    const shapeError = validateQuestionShape(data);
    if (shapeError) return fail(new ValidationError(shapeError));
    const contentError = validateQuestionContent(data);
    if (contentError) return fail(new ValidationError(contentError));

    return ok(
      await this.evaluations.addQuestion(actor.institutionId, evaluationId, sectionId, data),
    );
  }
}

export interface UpdateQuestionInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  questionId: string;
  data: UpdateQuestionData;
}

/**
 * Edita una pregunta. Solo el autor y solo en DRAFT.
 *
 * `options` y `correctAnswer` van juntas o no van: la validez de una depende
 * de la otra (la correcta debe existir entre las opciones), y aceptar solo
 * una obligaría a releer la pregunta para validar contra un estado a medias.
 * El formulario de edición envía siempre ambas.
 */
export class UpdateQuestion implements UseCase<UpdateQuestionInput, Question> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({
    actor,
    evaluationId,
    questionId,
    data,
  }: UpdateQuestionInput): Promise<Result<Question>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;

    const tocaOpciones = data.options !== undefined || data.correctAnswer !== undefined;
    if (tocaOpciones) {
      if (data.options === undefined || data.correctAnswer === undefined) {
        return fail(
          new ValidationError(
            "Para cambiar las opciones o la respuesta correcta hay que enviar ambas.",
          ),
        );
      }
      const shapeError = validateQuestionShape({
        options: data.options,
        correctAnswer: data.correctAnswer,
      });
      if (shapeError) return fail(new ValidationError(shapeError));
      // Validar contenido solo cuando el docente está tocando el enunciado
      // (envía `text`). Si NO lo envía, conservamos el enunciado original
      // (no se puede borrar por accidente) y solo validamos las opciones
      // nuevas.
      if (data.text !== undefined) {
        const contentError = validateQuestionContent({
          text: data.text,
          options: data.options,
        });
        if (contentError) return fail(new ValidationError(contentError));
      }
    }

    return ok(
      await this.evaluations.updateQuestion(actor.institutionId, evaluationId, questionId, data),
    );
  }
}

export interface DeleteQuestionInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  questionId: string;
}

/**
 * Elimina una pregunta; el repositorio renumera las siguientes.
 *
 * Cascada automática: si la sección a la que pertenecía la pregunta queda
 * con 0 preguntas, también se elimina. Regla de limpieza del modelo — una
 * sección sin preguntas es ruido en el cuadernillo y no debería sobrevivir.
 *
 * El borrado de la sección se hace en una segunda llamada al repo (no en
 * la misma transacción que `deleteQuestion`). Aceptable porque la edición
 * de formulaciones es DRAFT-only y de un solo usuario a la vez; no hay
 * concurrencia que provoque condiciones de carrera entre el delete y el
 * count.
 */
export class DeleteQuestion implements UseCase<DeleteQuestionInput, void> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({ actor, evaluationId, questionId }: DeleteQuestionInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;

    // 1. Localiza la sección dueña de la pregunta antes de borrarla — el repo
    // no expone sectionId tras el delete, y necesitamos sectionId para el
    // count y el posible deleteSection.
    const sectionId = await this.evaluations.findQuestionSectionId(
      actor.institutionId,
      evaluationId,
      questionId,
    );
    if (!sectionId) return fail(new NotFoundError("Pregunta", questionId));

    // 2. Borra la pregunta (el repo renumera internamente).
    await this.evaluations.deleteQuestion(actor.institutionId, evaluationId, questionId);

    // 3. Cascada: si la sección queda vacía, también la borramos.
    const remaining = await this.evaluations.countQuestionsInSection(sectionId);
    if (remaining === 0) {
      await this.evaluations.deleteSection(actor.institutionId, evaluationId, sectionId);
    }
    return ok(undefined);
  }
}

export interface DuplicateQuestionInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  questionId: string;
}

/**
 * Duplica una pregunta dentro de la misma formulación. La copia hereda todo
 * el contenido (enunciado, opciones, correcta, peso, justificación, etc.)
 * y se inserta al final de la numeración. La copia pierde `bankOriginId`:
 * deja de estar "anclada" al banco de preguntas, tal como cualquier
 * pregunta importada y luego editada.
 *
 * Reglas:
 *  - Solo `TEACHER` y `COORDINATOR`.
 *  - Solo en `DRAFT` (mismo que el resto de mutaciones de preguntas).
 *  - La pregunta origen debe pertenecer a la formulación.
 */
export class DuplicateQuestion implements UseCase<DuplicateQuestionInput, void> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({
    actor,
    evaluationId,
    questionId,
  }: DuplicateQuestionInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;
    await this.evaluations.duplicateQuestion(actor.institutionId, evaluationId, questionId);
    return ok(undefined);
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
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER", "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const evaluation = await this.evaluations.findById(actor.institutionId, evaluationId);
    if (!evaluation) return fail(new NotFoundError("Formulación", evaluationId));

    // COORDINATOR/ADMIN pueden editar settings de cualquier evaluation de su
    // institución; TEACHER solo las suyas.
    const isPrivileged = hasRole(actor, "ECU_LIDER", "ECU_MASTER");
    if (!isPrivileged && evaluation.teacherId !== actor.userId) {
      return fail(new NotFoundError("Formulación", evaluationId));
    }

    if (evaluation.status !== "DRAFT") {
      return fail(
        new ValidationError(
          "Solo se puede editar la duración mientras la formulación esté en BORRADOR.",
        ),
      );
    }

    const durationError = validateDurationMinutes(data.durationMinutes);
    if (durationError) return fail(new ValidationError(durationError));

    return ok(await this.evaluations.updateSettings(actor.institutionId, evaluationId, data));
  }
}

// ===== Reorder questions (drag & drop en el editor por contexto, Fase 10) =====

export interface ReorderQuestionsInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  sectionId: string;
  /** IDs de las preguntas en el orden deseado tras el drop. */
  orderedQuestionIds: string[];
}

/**
 * Reordena las preguntas de una sección. Las IDs recibidas deben corresponder
 * 1-a-1 con las preguntas actuales de la sección y deben estar **dentro** del
 * rango de preguntas que pertenecen al evaluationId de la request (regla
 * multi-tenant).
 *
 * El repositorio renumera cada pregunta según su posición en la lista y
 * recalcula `totalQuestions`. La numeración del cuadernillo queda continua
 * (la hoja OMR la asume así).
 */
export class ReorderQuestions implements UseCase<ReorderQuestionsInput, void> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({
    actor,
    evaluationId,
    sectionId,
    orderedQuestionIds,
  }: ReorderQuestionsInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    if (orderedQuestionIds.length === 0) {
      return fail(new ValidationError("La lista de preguntas está vacía."));
    }
    if (new Set(orderedQuestionIds).size !== orderedQuestionIds.length) {
      return fail(new ValidationError("La lista de preguntas contiene duplicados."));
    }

    const owned = await loadOwnedDraft(this.evaluations, actor, evaluationId);
    if (!owned.ok) return owned;

    await this.evaluations.reorderQuestions(
      actor.institutionId,
      evaluationId,
      sectionId,
      orderedQuestionIds,
    );
    return ok(undefined);
  }
}
