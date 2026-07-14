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
  const result = await makeCreateEvaluation().execute({
    actor,
    data: {
      title: str(formData, "title"),
      courseSubjectId: str(formData, "courseSubjectId"),
      periodId: str(formData, "periodId") || undefined,
      bookletNumber: bookletRaw ? Number(bookletRaw) : undefined,
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
