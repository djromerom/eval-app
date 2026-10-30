"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import type { AnswerKey, SoloLevel } from "@/modules/evaluations/domain/evaluation";
import {
  ANSWER_KEYS_ORDER,
  MAX_OPTIONS,
  MIN_OPTIONS,
} from "@/modules/evaluations/domain/evaluation";
import { DEFAULT_OPTIONS_COUNT } from "@/modules/option-rules/domain/option-rule";
import type { Difficulty } from "@/modules/question-bank/domain/bank-question";
import {
  makeCreateBankQuestion,
  makeExportQuestionToBank,
  makeImportBankQuestion,
} from "@/modules/question-bank/infrastructure/container";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createBankQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const tags = str(formData, "tags")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  // El número de opciones lo manda la regla de la asignatura (el form
  // envía `optionCount`). Acotamos a [MIN_OPTIONS, MAX_OPTIONS] —los límites
  // absolutos del dominio—; el rango de la regla (mínimo/máximo por
  // asignatura) lo valida el use case.
  const optionCountRaw = Number(str(formData, "optionCount"));
  const optionCount = Number.isInteger(optionCountRaw)
    ? Math.min(MAX_OPTIONS, Math.max(MIN_OPTIONS, optionCountRaw))
    : DEFAULT_OPTIONS_COUNT;
  const keys = ANSWER_KEYS_ORDER.slice(0, optionCount) as AnswerKey[];

  const result = await makeCreateBankQuestion().execute({
    actor,
    data: {
      subjectId: str(formData, "subjectId"),
      text: str(formData, "text"),
      options: keys.map((key) => ({
        key,
        text: str(formData, `option${key}`),
      })),
      correctAnswer: str(formData, "correctAnswer") as AnswerKey,
      soloLevel: (str(formData, "soloLevel") || null) as SoloLevel | null,
      menComponent: str(formData, "menComponent") || undefined,
      competency: str(formData, "competency") || undefined,
      difficulty: (str(formData, "difficulty") || "MEDIUM") as Difficulty,
      tags,
      isPersonal: formData.get("isPersonal") === "on",
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath("/teacher/question-bank");
  return { success: true };
}

export async function importBankQuestionAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const evaluationId = String(formData.get("evaluationId") ?? "");
  const result = await makeImportBankQuestion().execute({
    actor,
    bankQuestionId: String(formData.get("bankQuestionId") ?? ""),
    evaluationId,
    sectionId: String(formData.get("sectionId") ?? ""),
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
}

export async function exportQuestionToBankAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const evaluationId = String(formData.get("evaluationId") ?? "");
  const result = await makeExportQuestionToBank().execute({
    actor,
    evaluationId,
    questionId: String(formData.get("questionId") ?? ""),
    subjectId: String(formData.get("subjectId") ?? ""),
    isPersonal: formData.get("isPersonal") === "true",
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  revalidatePath("/teacher/question-bank");
}
