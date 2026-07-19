"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import type { AnswerKey, SoloLevel } from "@/modules/evaluations/domain/evaluation";
import { MIN_OPTIONS, ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";
import { env } from "@/config/env";
import {
  makeAddQuestion,
  makeAddSection,
  makeChangeEvaluationStatus,
  makeCreateEvaluation,
  makeDeleteQuestion,
  makeDeleteSection,
  makeUpdateQuestion,
  makeUpdateSection,
} from "@/modules/evaluations/infrastructure/container";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Parsea el JSON del editor rico; si no es JSON válido, lo trata como texto. */
function rich(formData: FormData, key: string): unknown {
  const raw = str(formData, key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function createEvaluationAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const bookletRaw = str(formData, "bookletNumber");
  // Sprint 7: duración estimada opcional al crear. "" → null (recae al
  // cálculo heurístico en la portada del compendio). Si el input trae
  // basura no-entera, se omite (undefined → use case no valida).
  const durationRaw = str(formData, "durationMinutes");
  let durationMinutes: number | null | undefined;
  if (durationRaw === "") {
    durationMinutes = null;
  } else {
    const parsed = Number(durationRaw);
    durationMinutes = Number.isInteger(parsed) ? parsed : undefined;
  }
  const result = await makeCreateEvaluation().execute({
    actor,
    data: {
      title: str(formData, "title"),
      courseSubjectId: str(formData, "courseSubjectId"),
      periodId: str(formData, "periodId") || undefined,
      bookletNumber: bookletRaw ? Number(bookletRaw) : undefined,
      durationMinutes,
    },
  });
  if (!result.ok) return { error: result.error.message };
  redirect(`/teacher/evaluations/${result.value.id}`);
}

export async function addSectionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeAddSection().execute({
    actor,
    evaluationId,
    data: { title: str(formData, "title") || undefined, content: rich(formData, "content") },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function updateSectionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeUpdateSection().execute({
    actor,
    evaluationId,
    sectionId: str(formData, "sectionId"),
    // Título vacío → null: el contexto vuelve a rotularse "Contexto N".
    data: { title: str(formData, "title") || null, content: rich(formData, "content") },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function deleteSectionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeDeleteSection().execute({
    actor,
    evaluationId,
    sectionId: str(formData, "sectionId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function addQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const soloLevel = str(formData, "soloLevel");
  const weightRaw = str(formData, "weight");

  // Lee la cantidad de opciones del formulario y la clampa a
  // [MIN_OPTIONS, env.EVAL_MAX_OPTIONS]. El form siempre envía
  // `optionCount` con el total actual de opciones visibles; el clamp
  // cubre dos casos: el cliente envía basura, o el admin bajó el
  // tope en .env y alguien tenía un form abierto con más opciones.
  // La librería tiene como techo absoluto 8 (AnswerKey A–H); la
  // cota real la pone la institución con EVAL_MAX_OPTIONS.
  const optionCountRaw = Number(str(formData, "optionCount"));
  const optionCount = Number.isInteger(optionCountRaw)
    ? Math.min(env.EVAL_MAX_OPTIONS, Math.max(MIN_OPTIONS, optionCountRaw))
    : env.EVAL_DEFAULT_OPTIONS;
  const keys = ANSWER_KEYS_ORDER.slice(0, optionCount) as AnswerKey[];

  const result = await makeAddQuestion().execute({
    actor,
    evaluationId,
    sectionId: str(formData, "sectionId"),
    data: {
      text: rich(formData, "text"),
      options: keys.map((key) => ({
        key,
        text: str(formData, `option${key}`),
      })),
      correctAnswer: str(formData, "correctAnswer") as AnswerKey,
      justification: str(formData, "justification") || undefined,
      weight: weightRaw ? Number(weightRaw) : undefined,
      soloLevel: (soloLevel || null) as SoloLevel | null,
      menComponent: str(formData, "menComponent") || undefined,
      competency: str(formData, "competency") || undefined,
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function updateQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const soloLevel = str(formData, "soloLevel");
  const weightRaw = str(formData, "weight");

  // Mismo clamp que en el alta: el form envía el total de opciones visibles.
  const optionCountRaw = Number(str(formData, "optionCount"));
  const optionCount = Number.isInteger(optionCountRaw)
    ? Math.min(env.EVAL_MAX_OPTIONS, Math.max(MIN_OPTIONS, optionCountRaw))
    : env.EVAL_DEFAULT_OPTIONS;
  const keys = ANSWER_KEYS_ORDER.slice(0, optionCount) as AnswerKey[];

  const result = await makeUpdateQuestion().execute({
    actor,
    evaluationId,
    questionId: str(formData, "questionId"),
    data: {
      text: rich(formData, "text"),
      options: keys.map((key) => ({ key, text: str(formData, `option${key}`) })),
      correctAnswer: str(formData, "correctAnswer") as AnswerKey,
      justification: str(formData, "justification") || null,
      weight: weightRaw ? Number(weightRaw) : undefined,
      soloLevel: (soloLevel || null) as SoloLevel | null,
      menComponent: str(formData, "menComponent") || null,
      competency: str(formData, "competency") || null,
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function deleteQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeDeleteQuestion().execute({
    actor,
    evaluationId,
    questionId: str(formData, "questionId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function submitForReviewAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeChangeEvaluationStatus().execute({
    actor,
    evaluationId,
    to: "IN_REVIEW",
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  revalidatePath("/teacher/evaluations");
}
