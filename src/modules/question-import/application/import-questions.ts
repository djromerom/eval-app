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
 *
 * `sectionId` es OPCIONAL cuando el destino es "evaluation": si falta y las
 * preguntas traen contextos compartidos, el use case crea una sección por cada
 * contexto y reparte las preguntas según `contextTitle`. Si falta y NO hay
 * contextos, devuelve error (no hay ancla donde meter las preguntas).
 */
export type ImportDestination =
  | { kind: "evaluation"; evaluationId: string; sectionId?: string }
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

    // Hay DOS caminos según si la importación trae o no `sectionId`:
    //
    //  - CON sectionId (camino legacy): todo va a una sección que el docente
    //    eligió. Los contextos compartidos se concatenan al `content` de esa
    //    sección. Sigue siendo útil para "añadir preguntas a un contexto que
    //    ya existe".
    //  - SIN sectionId: el docente NO eligió sección porque quiere que el
    //    sistema reparta las preguntas según el contexto que el parser ya
    //    detectó. Se crea UNA sección nueva por cada contexto único y cada
    //    pregunta va a la suya (cotejo por contextText / contextTitle). Las
    //    preguntas sin contexto caen a la PRIMERA sección creada (con info
    //    explícito al docente para que no se sorprenda).

    let sectionForQuestion: (q: ParsedQuestion, idx: number) => string | null;

    if (destination.sectionId) {
      // ---- Camino A: sectionId explícito ----
      // Solo validamos que la sección exista cuando vamos a FUSIONAR
      // contextos en ella. Si no hay contextos, confiamos en el sectionId
      // como ancla para `addQuestion` (la BD validará la FK si fuera inválida;
      // el uso histórico de esta rama con `sections: []` en los tests confirma
      // que la sección puede existir en la BD sin estar precargada en detail).
      if (uniqueContexts.length > 0) {
        const explicit = detail.sections.find((s) => s.id === destination.sectionId);
        if (!explicit) {
          return fail(new NotFoundError("Contexto de evaluación", destination.sectionId));
        }
        const merged = mergeContextsIntoSectionContent(explicit.content, uniqueContexts);
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
      const anchorSectionId = destination.sectionId;
      sectionForQuestion = () => anchorSectionId;
    } else {
      // ---- Camino B: auto-crear secciones por contexto ----
      if (uniqueContexts.length === 0) {
        return fail(
          new ValidationError(
            "Elige un contexto destino: la importación no trae contextos compartidos y no hay sección elegida donde anclar las preguntas.",
          ),
        );
      }

      // Mapa contextText → sectionId (y fallback contextTitle → sectionId para
      // preguntas que solo referencian el contexto por título sin repetir el
      // texto). El parser ya hace esta resolución, pero aquí defendemos
      // contra parsers que no la apliquen.
      const contextToSection = new Map<string, string>();
      const titleToSection = new Map<string, string>();

      for (const ctx of uniqueContexts) {
        const sec = await this.evaluations.addSection(
          actor.institutionId,
          destination.evaluationId,
          {
            title: deriveSectionTitle(ctx),
            content: toRichText(ctx),
          },
        );
        contextToSection.set(ctx, sec.id);
        if (sec.title) titleToSection.set(sec.title, sec.id);
      }

      // Fallback: preguntas SIN contexto van a la primera sección creada.
      // El docente ve el aviso en `infos`.
      const fallbackSectionId = contextToSection.values().next().value as string | undefined;

      // IMPORTANTE: capturamos el sectionId por ÍNDICE de la pregunta antes
      // de `stripContextFromQuestions`, porque el strip devuelve objetos
      // NUEVOS (spread) y perderíamos la referencia.
      const sectionByIndex: (string | null)[] = questions.map((q) => {
        if (q.contextText && contextToSection.has(q.contextText)) {
          return contextToSection.get(q.contextText)!;
        }
        if (q.contextTitle && titleToSection.has(q.contextTitle)) {
          return titleToSection.get(q.contextTitle)!;
        }
        return fallbackSectionId ?? null;
      });

      sectionForQuestion = (_q, idx) => sectionByIndex[idx] ?? null;

      const withoutContextCount = questions.filter((q) => !q.contextText).length;
      infos.push(
        `Se crearon ${uniqueContexts.length} sección(es) nuevas, una por cada contexto compartido detectado.`,
      );
      if (withoutContextCount > 0) {
        infos.push(
          `${withoutContextCount} pregunta(s) sin contexto se asignaron a la primera sección creada; revisalas o muévelas desde el editor.`,
        );
      }
    }

    // 2) Damos de alta cada pregunta ya sin `contextText`, para no duplicarlo
    //    ni en la pregunta ni en el contexto. `addQuestion` numera cada
    //    pregunta a partir de `totalQuestions`, así que el bucle secuencial
    //    preserva el orden del documento de origen. En paralelo se pisarían
    //    los números.
    const stripped = stripContextFromQuestions(questions);
    for (let idx = 0; idx < stripped.length; idx++) {
      const q = stripped[idx]!;
      const sectionId = sectionForQuestion(q, idx);
      if (!sectionId) {
        return fail(
          new ValidationError("No se pudo determinar la sección destino para una pregunta."),
        );
      }
      await this.evaluations.addQuestion(actor.institutionId, destination.evaluationId, sectionId, {
        text: toRichText(q.text),
        options: q.options.map((o) => ({ key: o.key, text: o.text })),
        correctAnswer: q.correctAnswer!, // partitionParsedQuestions ya lo garantizó
        competency: q.competency,
        menComponent: null,
      });
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

/**
 * Deriva un título legible a partir del texto crudo de un contexto. El parser
 * IA mete el contexto como bloque de texto plano sin título explícito; la
 * sección igual necesita un nombre que el docente vea en el índice.
 *
 * Heurística: primera línea no vacía, recortada a 80 chars. Si está vacía,
 * devuelve undefined (la sección aparecerá como "Contexto N" en la UI).
 */
function deriveSectionTitle(raw: string): string | undefined {
  const firstLine = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!firstLine) return undefined;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}
