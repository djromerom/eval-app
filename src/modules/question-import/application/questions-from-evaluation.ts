import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, fail, ok } from "@/shared/domain/result";
import type { AnswerKey, EvaluationRepository } from "@/modules/evaluations/domain/evaluation";
import { richTextToPlain } from "@/shared/domain/rich-text";
import type { ParseResult, ParsedQuestion } from "../domain/parsed-question";

export interface QuestionsFromEvaluationInput {
  actor: AuthenticatedUser;
  /** Formulación de la que se copian las preguntas. */
  evaluationId: string;
  /** Si se indica, solo las preguntas de ese contexto. */
  sectionId?: string;
}

/**
 * Origen "otra formulación": convierte las preguntas de una formulación
 * existente al formato intermedio de la importación.
 *
 * No copia nada por sí mismo — solo lee. El alta la hace `ImportQuestions`,
 * igual que con los orígenes de archivo, así que la copia entre formulaciones
 * pasa por la misma pantalla de revisión y el docente puede descartar o
 * ajustar antes de confirmar.
 *
 * A diferencia de los parsers de archivo, aquí NO hay avisos: el origen es la
 * propia base de datos, así que las preguntas ya están bien formadas.
 */
export class QuestionsFromEvaluation implements UseCase<QuestionsFromEvaluationInput, ParseResult> {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async execute({
    actor,
    evaluationId,
    sectionId,
  }: QuestionsFromEvaluationInput): Promise<Result<ParseResult>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;

    // `getDetail` filtra por institución, así que no se pueden leer preguntas
    // de otro colegio aunque se acierte el id.
    const detail = await this.evaluations.getDetail(actor.institutionId, evaluationId);
    if (!detail) return fail(new NotFoundError("Formulación", evaluationId));

    const sections = sectionId
      ? detail.sections.filter((s) => s.id === sectionId)
      : detail.sections;

    const questions: ParsedQuestion[] = sections.flatMap((section) => {
      // El contexto se arrastra con cada pregunta: la pantalla de revisión lo
      // muestra para que el docente sepa a qué texto se refería el enunciado.
      const contextText = richTextToPlain(section.content) || null;
      return section.questions.map((q) => ({
        sourceNumber: q.number,
        text: richTextToPlain(q.text),
        options: q.options.map((o) => ({
          key: o.key as AnswerKey,
          text: richTextToPlain(o.text),
        })),
        correctAnswer: q.correctAnswer,
        competency: q.competency,
        evidence: null, // `Question` no expone `evidence` en el dominio
        contextTitle: section.title,
        contextText,
        image: null, // copiar de BD: no se re-sube lo que ya está en disco
        warnings: [],
      }));
    });

    return ok({ questions, warnings: [] });
  }
}
