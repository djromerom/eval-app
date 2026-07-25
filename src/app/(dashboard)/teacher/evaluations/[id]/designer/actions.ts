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
 * Guarda el tema de la formulación (override por formulación).
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
    // Solo 1 o 2; cualquier otra cosa cae al heredado (undefined).
    questionColumns: String(formData.get("questionColumns") ?? "") === "2" ? 2 : 1,
    footerText: String(formData.get("footerText") ?? "").trim() || undefined,
    showLogo: formData.get("showLogo") === "on",
    coverSubtitle: String(formData.get("coverSubtitle") ?? "").trim() || undefined,
    sectionDivider: ["line", "double", "dots"].includes(
      String(formData.get("sectionDivider") ?? ""),
    )
      ? (String(formData.get("sectionDivider")) as "line" | "double" | "dots")
      : undefined,
  };

  // introText es JSON serializado de TipTap. Si viene vacío lo descartamos;
  // si viene JSON inválido lo registramos como error de validación en lugar
  // de tirar la request (un docente pegando texto crudo no debe tirar todo).
  const introRaw = String(formData.get("introText") ?? "").trim();
  if (introRaw) {
    try {
      const parsed = JSON.parse(introRaw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        theme.introText = parsed as Record<string, unknown>;
      } else {
        return { error: "Bloque intro: el contenido no es un documento TipTap válido." };
      }
    } catch {
      return { error: "Bloque intro: JSON inválido. ¿Se modificó el editor manualmente?" };
    }
  }

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
