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
import {
  collectUniqueContexts,
  mergeContextsIntoSectionContent,
  prependContextToBankQuestion,
  stripContextFromQuestions,
} from "./context-stitch";

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
  /** Mensajes no-fatales sobre cómo se acomodaron cosas (contexto compartido,
   *  advertencias estructurales). Se muestran en el banner de éxito para
   *  que el docente sepa qué pasó con su información. */
  infos: string[];
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
 *
 * Sobre el contexto compartido (Fase 3 → corrección): los parsers ya lo leen
 * pero la BD no tiene una columna `contextText` por pregunta, así que aquí
 * decidimos a dónde va:
 *  - **Evaluación destino**: el contexto se PROMUeve al `section.content`
 *    (TipTap) UNA sola vez para todas las preguntas que lo compartían. Si ya
 *    había contenido en la sección, se concatena con un separador.
 *  - **Banco destino**: el contexto se EMBEBE al inicio del TipTap `text` de
 *    cada pregunta que lo traiga (con un encabezado "Contexto"). El banco
 *    hoy no almacena contexto compartido aparte.
 *
 * En ambos casos el docente ve un `info` en el banner de éxito describiendo
 * la decisión: nunca pierde información silenciosamente.
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

    const result =
      destination.kind === "evaluation"
        ? await this.intoEvaluation(actor, valid, destination)
        : await this.intoBank(actor, valid, destination);

    if (!result.ok) return result;
    return ok({ imported: result.value.imported, problems, infos: result.value.infos });
  }

  /** Añade a un contexto de una evaluación propia y en BORRADOR. */
  private async intoEvaluation(
    actor: AuthenticatedUser,
    questions: ParsedQuestion[],
    destination: Extract<ImportDestination, { kind: "evaluation" }>,
  ): Promise<Result<{ imported: number; infos: string[] }>> {
    // Necesitamos `getDetail` (no `findById`) porque vamos a leer el contenido
    // actual del contexto para fusionar el contexto compartido entrante.
    const detail = await this.evaluations.getDetail(actor.institutionId, destination.evaluationId);
    if (!detail) return fail(new NotFoundError("Evaluación", destination.evaluationId));
    if (detail.teacherId !== actor.userId) {
      return fail(new ValidationError("Solo el autor puede editar la evaluación."));
    }
    if (detail.status !== "DRAFT") {
      return fail(new ValidationError("Solo se puede editar una evaluación en BORRADOR."));
    }

    const infos: string[] = [];
    const uniqueContexts = collectUniqueContexts(questions);

    // 1) Si hay contextos compartidos, los añadimos al contenido del contexto
    //    destino. Hecho antes del bucle de `addQuestion` para que las preguntas
    //    ya no traigan `contextText` (lo hemos subido de nivel).
    if (uniqueContexts.length > 0) {
      const section = detail.sections.find((s) => s.id === destination.sectionId);
      if (!section) return fail(new NotFoundError("Contexto de evaluación", destination.sectionId));
      const merged = mergeContextsIntoSectionContent(section.content, uniqueContexts);
      await this.evaluations.updateSection(
        actor.institutionId,
        destination.evaluationId,
        destination.sectionId,
        { content: merged },
      );
      if (uniqueContexts.length === 1) {
        infos.push(
          "El contexto compartido se guardó en el contexto de evaluación (afecta a todas las preguntas que lo compartían).",
        );
      } else {
        infos.push(
          `Se encontraron ${uniqueContexts.length} contextos distintos y se concatenaron en el contexto de evaluación. Si varios no comparten texto, conviene dividirlos en varias importaciones.`,
        );
      }
    }

    // 2) Damos de alta cada pregunta ya sin `contextText`, para no duplicarlo
    //    ni en la pregunta ni en el contexto. `addQuestion` numera cada
    //    pregunta a partir de `totalQuestions`, así que el bucle secuencial
    //    preserva el orden del documento de origen. En paralelo se pisarían
    //    los números.
    const stripped = stripContextFromQuestions(questions);
    for (const q of stripped) {
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
    return ok({ imported: stripped.length, infos });
  }

  /** Guarda en el banco, todas con la misma asignatura. */
  private async intoBank(
    actor: AuthenticatedUser,
    questions: ParsedQuestion[],
    destination: Extract<ImportDestination, { kind: "bank" }>,
  ): Promise<Result<{ imported: number; infos: string[] }>> {
    if (!destination.subjectId) {
      return fail(new ValidationError("Elige la asignatura del banco."));
    }

    const infos: string[] = [];
    const withContextInlined = questions.map((q) => {
      if (!q.contextText) return { text: toRichText(q.text) };
      return {
        text: prependContextToBankQuestion(toRichText(q.text), q.contextTitle, q.contextText),
      };
    });

    const data: CreateBankQuestionData[] = questions.map((q, idx) => ({
      subjectId: destination.subjectId,
      text: withContextInlined[idx]!.text,
      options: q.options.map((o) => ({ key: o.key, text: o.text })),
      correctAnswer: q.correctAnswer!,
      competency: q.competency,
      evidence: q.evidence,
    }));

    const withContextCount = questions.filter((q) => Boolean(q.contextText)).length;
    if (withContextCount > 0) {
      infos.push(
        `El banco no guarda contexto compartido: se añadió al inicio del enunciado de ${withContextCount} pregunta(s) con un encabezado «Contexto».`,
      );
    }

    return ok({
      imported: await this.bank.createMany(actor.institutionId, actor.userId, data),
      infos,
    });
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
