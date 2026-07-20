"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type {
  ParsedQuestion,
  ParsedQuestionProblem,
} from "@/modules/question-import/domain/parsed-question";
import { parseQuestionsCsv } from "@/modules/question-import/infrastructure/csv";
import { parseQuestionsDocx } from "@/modules/question-import/infrastructure/docx";
import { makeUploadImageForInstitution } from "@/modules/question-import/infrastructure/docx-upload";
import {
  makeImportQuestions,
  makeQuestionsFromEvaluation,
} from "@/modules/question-import/infrastructure/container";

export interface CommitImportState {
  error?: string;
  imported?: number;
  problems?: ParsedQuestionProblem[];
  /** Mensajes no-fatales (cómo se reubicó el contexto compartido). */
  infos?: string[];
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

  return {
    imported: result.value.imported,
    problems: result.value.problems,
    infos: result.value.infos,
  };
}

export interface LoadSourceState {
  questions: ParsedQuestion[];
  warnings: string[];
  error?: string;
}

/**
 * Carga las preguntas de la fuente seleccionada por el docente. Es el
 * único punto de entrada para todos los orígenes: hoy "evaluación", "CSV"
 * y "DOCX"; mañana "PDF" cae aquí sin tocar la pantalla de revisión.
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

/**
 * Variante para DOCX: el archivo se sube como `multipart` por su tamaño
 * (un DOCX con 10 preguntas y 8 imágenes llega a ~3 MB). Lo dejamos en su
 * propia action porque no encaja con la firma plana de `loadSourceAction`
 * (que serializa el payload en JSON para evitar serializar el DOCX).
 */
export async function loadDocxSourceAction(formData: FormData): Promise<LoadSourceState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { questions: [], warnings: [], error: "Falta el archivo DOCX." };
  }
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return { questions: [], warnings: [], error: "El archivo tiene que ser .docx." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploadImage = makeUploadImageForInstitution();
  try {
    const parsed = await parseQuestionsDocx({
      buffer,
      institutionId: actor.institutionId,
      uploadImage,
    });
    return parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo leer el DOCX.";
    return { questions: [], warnings: [], error: message };
  }
}
