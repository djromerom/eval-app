"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import {
  makeCreateTemplate,
  makeDeleteTemplate,
} from "@/modules/evaluations/infrastructure/container";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function num(formData: FormData, key: string): number {
  const v = Number(formData.get(key));
  return Number.isFinite(v) ? v : 0;
}

export async function createTemplateAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const sections: { title: string; numQuestions: number; order: number }[] = [];
  const count = num(formData, "sectionCount");
  for (let i = 0; i < count; i++) {
    const title = str(formData, `sectionTitle_${i}`);
    const numQ = num(formData, `sectionNumQ_${i}`);
    if (numQ > 0) {
      sections.push({ title, numQuestions: numQ, order: i });
    }
  }

  const result = await makeCreateTemplate().execute({
    actor,
    data: {
      name: str(formData, "name"),
      description: str(formData, "description") || undefined,
      courseSubjectId: str(formData, "courseSubjectId"),
      structure: sections,
    },
  });

  if (!result.ok) return { error: result.error.message };
  revalidatePath("/teacher/templates");
  redirect(`/teacher/templates`);
}

export async function deleteTemplateAction(formData: FormData) {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  await makeDeleteTemplate().execute({ actor, id: str(formData, "templateId") });
  revalidatePath("/teacher/templates");
}

export async function applyTemplateAction(formData: FormData) {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const templateId = str(formData, "templateId");
  const evaluationId = str(formData, "evaluationId");
  if (!templateId || !evaluationId) return;
  const result = await (
    await import("@/modules/evaluations/infrastructure/container")
  )
    .makeApplyTemplate()
    .execute({
      actor,
      templateId,
      evaluationId,
    });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  redirect(`/teacher/evaluations/${evaluationId}`);
}
