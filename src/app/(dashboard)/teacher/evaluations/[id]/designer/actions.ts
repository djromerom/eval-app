"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeUpdateEvaluationTheme } from "@/modules/theme/infrastructure/container";
import type { EvaluationTheme } from "@/modules/theme/domain/theme";

export interface DesignerFormState {
  error?: string;
  success?: boolean;
}

/**
 * Guarda el tema de la evaluación (override por evaluación).
 *
 * - TEACHER dueño + COORDINATOR: pueden editar.
 * - Solo en DRAFT (verificado por el use case UpdateEvaluationTheme).
 */
export async function saveEvaluationThemeAction(
  evaluationId: string,
  _prev: DesignerFormState,
  formData: FormData,
): Promise<DesignerFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const theme: Partial<EvaluationTheme> = {
    primary: String(formData.get("primary") ?? "").trim() || undefined,
    fontFamily: formData.get("fontFamily") === "sans" ? "sans" : "serif",
    density: ["compact", "normal", "airy"].includes(String(formData.get("density") ?? ""))
      ? (String(formData.get("density")) as "compact" | "normal" | "airy")
      : undefined,
    footerText: String(formData.get("footerText") ?? "").trim() || undefined,
    showLogo: formData.get("showLogo") === "on",
    coverSubtitle: String(formData.get("coverSubtitle") ?? "").trim() || undefined,
    sectionDivider: ["line", "double", "dots"].includes(
      String(formData.get("sectionDivider") ?? ""),
    )
      ? (String(formData.get("sectionDivider")) as "line" | "double" | "dots")
      : undefined,
  };

  const result = await makeUpdateEvaluationTheme().execute({
    actor,
    evaluationId,
    theme,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  revalidatePath(`/teacher/evaluations/${evaluationId}/designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}

/** Limpia el override y vuelve al tema institucional. */
export async function resetEvaluationThemeAction(evaluationId: string): Promise<DesignerFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const result = await makeUpdateEvaluationTheme().execute({
    actor,
    evaluationId,
    reset: true,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  revalidatePath(`/teacher/evaluations/${evaluationId}/designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}
