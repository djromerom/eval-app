"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import type { AnswerKey, SoloLevel } from "@/modules/evaluations/domain/evaluation";
import {
  makeAddQuestion,
  makeAddSection,
  makeChangeEvaluationStatus,
  makeCreateEvaluation,
} from "@/modules/evaluations/infrastructure/container";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
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

export async function addSectionAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeAddSection().execute({
    actor,
    evaluationId,
    data: { title: str(formData, "title") || undefined },
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
}

export async function addQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const evaluationId = str(formData, "evaluationId");
  const soloLevel = str(formData, "soloLevel");
  const weightRaw = str(formData, "weight");

  const result = await makeAddQuestion().execute({
    actor,
    evaluationId,
    sectionId: str(formData, "sectionId"),
    data: {
      text: str(formData, "text"),
      options: (["A", "B", "C", "D"] as AnswerKey[]).map((key) => ({
        key,
        text: str(formData, `option${key}`),
      })),
      correctAnswer: str(formData, "correctAnswer") as AnswerKey,
      justification: str(formData, "justification") || undefined,
      weight: weightRaw ? Number(weightRaw) : undefined,
      soloLevel: (soloLevel || null) as SoloLevel | null,
      menComponent: str(formData, "menComponent") || undefined,
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
