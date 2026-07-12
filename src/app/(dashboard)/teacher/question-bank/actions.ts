"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import type { AnswerKey, SoloLevel } from "@/modules/evaluations/domain/evaluation";
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
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const tags = str(formData, "tags")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const result = await makeCreateBankQuestion().execute({
    actor,
    data: {
      subjectId: str(formData, "subjectId"),
      text: str(formData, "text"),
      options: (["A", "B", "C", "D"] as AnswerKey[]).map((key) => ({
        key,
        text: str(formData, `option${key}`),
      })),
      correctAnswer: str(formData, "correctAnswer") as AnswerKey,
      soloLevel: (str(formData, "soloLevel") || null) as SoloLevel | null,
      menComponent: str(formData, "menComponent") || undefined,
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
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
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
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
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
