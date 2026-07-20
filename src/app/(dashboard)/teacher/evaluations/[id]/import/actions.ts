"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type {
  ParsedQuestion,
  ParsedQuestionProblem,
} from "@/modules/question-import/domain/parsed-question";
import { parseQuestionsCsv } from "@/modules/question-import/infrastructure/csv";
import {
  makeImportQuestions,
  makeQuestionsFromEvaluation,
} from "@/modules/question-import/infrastructure/container";

export interface CommitImportState {
  error?: string;
  imported?: number;
  problems?: ParsedQuestionProblem[];
}

/**
 * Recibe la revisión del docente (qué preguntas, qué respuesta correcta) y
 * ejecuta el alta. Los índices vienen como cadenas separadas por coma porque
 * los formularios HTML no admiten arrays.
 */
export async function commitImportAction(
  _prev: CommitImportState | null,
  formData: FormData,
): Promise<CommitImportState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const destinationKind = String(formData.get("destinationKind") ?? "");
  const destinationId = String(formData.get("destinationId") ?? "").trim();
  const evaluationId = String(formData.get("evaluationId") ?? "").trim();
  const sectionId = String(formData.get("sectionId") ?? "").trim();
  const payloadRaw = String(formData.get("payload") ?? "");
  const correctionsRaw = String(formData.get("corrections") ?? "{}");

  if (!destinationKind || !destinationId) {
    return { error: "Elige un destino para la importación." };
  }
  if (destinationKind === "evaluation" && (!evaluationId || !sectionId)) {
    return { error: "Falta la evaluación o el contexto destino." };
  }

  let questions: ParsedQuestion[];
  try {
    questions = JSON.parse(payloadRaw) as ParsedQuestion[];
  } catch {
    return { error: "El formulario de revisión está corrupto. Recarga la página." };
  }

  let corrections: Record<number, AnswerKey> = {};
  try {
    corrections = JSON.parse(correctionsRaw) as Record<number, AnswerKey>;
  } catch {
    corrections = {};
  }

  // El docente decide cuáles entran y puede corregir la respuesta correcta
  // cuando el origen no la traía.
  const included = formData.getAll("include").map(String);
  const filtered = questions.filter((_, idx) => included.includes(String(idx)));
  const finalized = filtered.map((q, idx) => ({
    ...q,
    correctAnswer: q.correctAnswer ?? corrections[idx] ?? null,
  }));

  const destination =
    destinationKind === "evaluation"
      ? ({ kind: "evaluation", evaluationId, sectionId } as const)
      : ({ kind: "bank", subjectId: destinationId } as const);

  const result = await makeImportQuestions().execute({
    actor,
    questions: finalized,
    destination,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  revalidatePath(`/teacher/evaluations/${evaluationId}/import`);
  revalidatePath("/teacher/question-bank");
  revalidatePath("/teacher/evaluations");

  // Devuelve éxito al cliente para que muestre el resumen.
  return {
    imported: result.value.imported,
    problems: result.value.problems,
  };
}

export interface LoadSourceState {
  questions: ParsedQuestion[];
  warnings: string[];
  error?: string;
}

/**
 * Carga las preguntas de la fuente seleccionada por el docente. Es el
 * único punto de entrada para todos los orígenes: hoy "evaluación" y
 * "CSV"; mañana "DOCX" y "PDF" caen aquí sin tocar la pantalla de revisión.
 *
 * Se hace un único overload en la implementación (sin firmas separadas)
 * porque TS no las resuelve bien cuando se pasa una unión discriminada.
 */
export type LoadSourceInput =
  { kind: "evaluation"; evaluationId: string } | { kind: "csv"; content: string };

export async function loadSourceAction(input: LoadSourceInput): Promise<LoadSourceState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  if (input.kind === "evaluation") {
    const result = await makeQuestionsFromEvaluation().execute({
      actor,
      evaluationId: input.evaluationId,
    });
    if (!result.ok) return { questions: [], warnings: [], error: result.error.message };
    return result.value;
  }

  // CSV: parsea aquí en servidor para no enviar el parser al cliente.
  const parsed = parseQuestionsCsv(input.content);
  if (parsed.missing.length > 0) {
    return {
      questions: [],
      warnings: [],
      error: `Faltan columnas en el CSV: ${parsed.missing.join(", ")}.`,
    };
  }
  return parsed.result;
}
