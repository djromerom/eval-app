"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import { makeChangeEvaluationStatus } from "@/modules/evaluations/infrastructure/container";

const PATH = "/coordinator/review";

async function transition(evaluationId: string, to: "APPROVED" | "PUBLISHED") {
  const actor = await requireAuthenticatedUser("COORDINATOR");
  const result = await makeChangeEvaluationStatus().execute({ actor, evaluationId, to });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(PATH);
}

export async function approveAction(formData: FormData): Promise<void> {
  await transition(String(formData.get("evaluationId") ?? ""), "APPROVED");
}

export async function publishAction(formData: FormData): Promise<void> {
  await transition(String(formData.get("evaluationId") ?? ""), "PUBLISHED");
}

export async function rejectAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("COORDINATOR");
  const result = await makeChangeEvaluationStatus().execute({
    actor,
    evaluationId: String(formData.get("evaluationId") ?? ""),
    to: "DRAFT",
    comment: String(formData.get("comment") ?? "").trim(),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}
