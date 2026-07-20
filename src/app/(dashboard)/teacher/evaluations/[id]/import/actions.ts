"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type {
  ParsedQuestion,
  ParsedQuestionProblem,
} from "@/modules/question-import/domain/parsed-question";
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

/**
 * Server action puente: el cliente envía el id de la evaluación origen y
 * este action redirige a la misma página con `?source=`. Lo hacemos action y
 * no un link directo para poder validar que la evaluación origen existe y es
 * accesible antes de saltar a la revisión.
 */
export async function pickSourceAction(formData: FormData): Promise<void> {
  await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = String(formData.get("evaluationId") ?? "").trim();
  const targetEvaluationId = String(formData.get("targetEvaluationId") ?? "").trim();
  if (!evaluationId || !targetEvaluationId) return;
  redirect(
    `/teacher/evaluations/${targetEvaluationId}/import?source=${encodeURIComponent(evaluationId)}`,
  );
}

export interface LoadSourceState {
  questions: ParsedQuestion[];
  warnings: string[];
  error?: string;
}

/**
 * Carga las preguntas de la evaluación origen. Se llama desde el cliente cuando
 * el usuario confirma la selección, para evitar tener que serializar el array
 * en la URL cuando pueda ser grande.
 */
export async function loadSourceAction(sourceEvaluationId: string): Promise<LoadSourceState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const result = await makeQuestionsFromEvaluation().execute({
    actor,
    evaluationId: sourceEvaluationId,
  });
  if (!result.ok) return { questions: [], warnings: [], error: result.error.message };
  return result.value;
}
