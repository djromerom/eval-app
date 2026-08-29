import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { NotificationSender } from "@/modules/notifications/domain/notification";
import type { EvaluationRuleRepository } from "@/modules/evaluation-rules/domain/evaluation-rule";
import { type EvaluationStatus, findTransition } from "../domain/evaluation-status";
import type { Evaluation, EvaluationRepository } from "../domain/evaluation";

/** Resuelve destinatarios de notificaciones por rol (implementado sobre users). */
export interface CoordinatorDirectory {
  coordinatorIds(institutionId: string): Promise<string[]>;
}

export interface ChangeEvaluationStatusInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  to: EvaluationStatus;
  comment?: string;
}

/**
 * Aplica una transición del flujo de aprobación (§3.3) validándola contra la
 * máquina de estados, exigiendo comentario en el rechazo y emitiendo las
 * notificaciones in-app correspondientes.
 */
export class ChangeEvaluationStatus implements UseCase<ChangeEvaluationStatusInput, Evaluation> {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly notifications: NotificationSender,
    private readonly directory: CoordinatorDirectory,
    private readonly evaluationRules: EvaluationRuleRepository,
  ) {}

  async execute({
    actor,
    evaluationId,
    to,
    comment,
  }: ChangeEvaluationStatusInput): Promise<Result<Evaluation>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const evaluation = await this.evaluations.findById(actor.institutionId, evaluationId);
    if (!evaluation) return fail(new NotFoundError("Formulación", evaluationId));

    const transition = findTransition(evaluation.status, to);
    if (!transition || !transition.allowedRoles.some((r) => actor.roles.includes(r))) {
      return fail(new ValidationError(`Transición no permitida: ${evaluation.status} → ${to}.`));
    }
    // Ownership: solo el autor puede enviar a revisión o publicar
    // directamente. COORDINATOR puede hacerlo porque tiene una regla
    // transversal: en este dominio, un COORDINATOR que no es el autor
    // todavía puede operar sobre formulaciones ajenas (ej. aprobarlas).
    // Aquí limitamos explícitamente el caso del TEACHER: si su rol es
    // TEACHER pero NO es el autor, falla. COORDINATOR pasa siempre.
    if (
      (to === "IN_REVIEW" || to === "PUBLISHED") &&
      actor.roles.includes("TEACHER") &&
      !actor.roles.includes("ECU_LIDER") &&
      evaluation.teacherId !== actor.userId
    ) {
      return fail(
        new ValidationError(
          to === "IN_REVIEW"
            ? "Solo el autor puede enviar la formulación a revisión."
            : "Solo el autor puede publicar la formulación.",
        ),
      );
    }
    // Regla institucional de conteo exacto: si la tupla
    // (period, course, subject, bookletType) tiene una regla activa, el
    // número de preguntas debe coincidir antes de salir de DRAFT.
    // Sprint ago 2026 — ver src/modules/evaluation-rules/.
    if (to === "IN_REVIEW" || to === "PUBLISHED") {
      const rule = await this.evaluationRules.findForEvaluation(
        actor.institutionId,
        evaluation.courseSubjectId,
        evaluation.periodId,
        evaluation.bookletTypeId,
      );
      if (rule && evaluation.totalQuestions !== rule.exactQuestions) {
        return fail(
          new ValidationError(
            `La evaluación debe tener exactamente ${rule.exactQuestions} preguntas ` +
              `(tiene ${evaluation.totalQuestions}) para esta prueba y tipo de cuadernillo.`,
          ),
        );
      }
    }
    if (transition.requiresComment && !comment?.trim()) {
      return fail(new ValidationError("El rechazo requiere un comentario."));
    }

    const from = evaluation.status;
    await this.evaluations.updateStatus(actor.institutionId, evaluationId, to);
    await this.notify(actor, evaluation, from, to, comment);

    return ok({ ...evaluation, status: to });
  }

  private async notify(
    actor: AuthenticatedUser,
    evaluation: Evaluation,
    from: EvaluationStatus,
    to: EvaluationStatus,
    comment?: string,
  ): Promise<void> {
    const teacherLink = `/teacher/evaluations/${evaluation.id}/contexts`;
    const reviewLink = `/coordinator/review`;

    if (to === "IN_REVIEW") {
      const coordinators = await this.directory.coordinatorIds(actor.institutionId);
      await Promise.all(
        coordinators.map((userId) =>
          this.notifications.send({
            userId,
            type: "EVALUATION_PENDING_REVIEW",
            title: "Formulación pendiente de revisión",
            body: `"${evaluation.title}" fue enviada a revisión.`,
            link: reviewLink,
          }),
        ),
      );
      return;
    }
    if (to === "APPROVED") {
      await this.notifications.send({
        userId: evaluation.teacherId,
        type: "EVALUATION_APPROVED",
        title: "Formulación aprobada",
        body: `"${evaluation.title}" fue aprobada.`,
        link: teacherLink,
      });
      return;
    }
    // PUBLICADA — cubre dos caminos:
    //  - APPROVED → PUBLISHED (canónico)
    //  - DRAFT → PUBLISHED (atajo desde el editor unificado, ago 2026)
    // En ambos casos notificamos al autor para que tenga feedback de que
    // la formulación pasó a versión final.
    if (to === "PUBLISHED") {
      await this.notifications.send({
        userId: evaluation.teacherId,
        type: "EVALUATION_PUBLISHED",
        title: "Formulación publicada",
        body: `"${evaluation.title}" fue publicada.`,
        link: teacherLink,
      });
      return;
    }
    // Rechazo (IN_REVIEW → DRAFT) con comentario obligatorio.
    if (to === "DRAFT" && from === "IN_REVIEW") {
      await this.notifications.send({
        userId: evaluation.teacherId,
        type: "EVALUATION_REJECTED",
        title: "Formulación rechazada",
        body: comment ?? "Sin comentario.",
        link: teacherLink,
      });
    }
  }
}
