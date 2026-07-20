import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { EvaluationRepository } from "@/modules/evaluations/domain/evaluation";
import type {
  BankQuestionRepository,
  CreateBankQuestionData,
} from "@/modules/question-bank/domain/bank-question";
import {
  type ParsedQuestion,
  type ParsedQuestionProblem,
  partitionParsedQuestions,
} from "../domain/parsed-question";

/**
 * A dónde van las preguntas importadas. Lo elige el docente en la pantalla de
 * revisión: puede meterlas en la evaluación que está armando, o guardarlas en
 * el banco para reutilizarlas después.
 */
export type ImportDestination =
  | { kind: "evaluation"; evaluationId: string; sectionId: string }
  | { kind: "bank"; subjectId: string };

export interface ImportQuestionsInput {
  actor: AuthenticatedUser;
  questions: ParsedQuestion[];
  destination: ImportDestination;
}

export interface ImportQuestionsResult {
  imported: number;
  /** Las que no se pudieron dar de alta, con el motivo. */
  problems: ParsedQuestionProblem[];
}

/**
 * Da de alta las preguntas que el docente confirmó en la revisión.
 *
 * Igual que `ImportStudents`, NO aborta ante una pregunta mala: da de alta las
 * buenas y devuelve el detalle de las que se quedaron fuera. Importar 20
 * preguntas y perderlas todas porque una tenía una opción vacía sería un mal
 * negocio para el docente.
 *
 * El texto llega como string plano desde los parsers y se convierte aquí a
 * documento TipTap, que es lo que espera la base de datos.
 */
export class ImportQuestions implements UseCase<ImportQuestionsInput, ImportQuestionsResult> {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly bank: BankQuestionRepository,
  ) {}

  async execute({
    actor,
    questions,
    destination,
  }: ImportQuestionsInput): Promise<Result<ImportQuestionsResult>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;

    if (questions.length === 0) {
      return fail(new ValidationError("No hay preguntas para importar."));
    }

    const { valid, problems } = partitionParsedQuestions(questions);
    if (valid.length === 0) {
      return fail(
        new ValidationError(
          "Ninguna de las preguntas está lista para importar. Revisa los avisos.",
        ),
      );
    }

    const imported =
      destination.kind === "evaluation"
        ? await this.intoEvaluation(actor, valid, destination)
        : await this.intoBank(actor, valid, destination);

    if (!imported.ok) return imported;
    return ok({ imported: imported.value, problems });
  }

  /** Añade a un contexto de una evaluación propia y en BORRADOR. */
  private async intoEvaluation(
    actor: AuthenticatedUser,
    questions: ParsedQuestion[],
    destination: Extract<ImportDestination, { kind: "evaluation" }>,
  ): Promise<Result<number>> {
    const evaluation = await this.evaluations.findById(
      actor.institutionId,
      destination.evaluationId,
    );
    if (!evaluation) return fail(new NotFoundError("Evaluación", destination.evaluationId));
    if (evaluation.teacherId !== actor.userId) {
      return fail(new ValidationError("Solo el autor puede editar la evaluación."));
    }
    if (evaluation.status !== "DRAFT") {
      return fail(new ValidationError("Solo se puede editar una evaluación en BORRADOR."));
    }

    // `addQuestion` numera cada pregunta a partir de `totalQuestions`, así que
    // el bucle secuencial preserva el orden del documento de origen. En
    // paralelo se pisarían los números.
    for (const q of questions) {
      await this.evaluations.addQuestion(
        actor.institutionId,
        destination.evaluationId,
        destination.sectionId,
        {
          text: toRichText(q.text),
          options: q.options.map((o) => ({ key: o.key, text: o.text })),
          correctAnswer: q.correctAnswer!, // partitionParsedQuestions ya lo garantizó
          competency: q.competency,
          menComponent: null,
        },
      );
    }
    return ok(questions.length);
  }

  /** Guarda en el banco, todas con la misma asignatura. */
  private async intoBank(
    actor: AuthenticatedUser,
    questions: ParsedQuestion[],
    destination: Extract<ImportDestination, { kind: "bank" }>,
  ): Promise<Result<number>> {
    if (!destination.subjectId) {
      return fail(new ValidationError("Elige la asignatura del banco."));
    }

    const data: CreateBankQuestionData[] = questions.map((q) => ({
      subjectId: destination.subjectId,
      text: toRichText(q.text),
      options: q.options.map((o) => ({ key: o.key, text: o.text })),
      correctAnswer: q.correctAnswer!,
      competency: q.competency,
      evidence: q.evidence,
    }));

    return ok(await this.bank.createMany(actor.institutionId, actor.userId, data));
  }
}

/**
 * Envuelve texto plano en un documento TipTap de un párrafo.
 *
 * Los parsers devuelven string porque lo que se lee de un Word o un CSV no
 * trae formato aprovechable. La conversión se hace aquí, en el borde con la
 * persistencia, y no en cada parser.
 */
function toRichText(text: string): unknown {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}
