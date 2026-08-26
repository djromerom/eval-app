"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import { makeUpdateEvaluationSettings } from "@/modules/evaluations/infrastructure/container";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Server action del panel Settings (Sprint 7).
 * Lee `durationMinutes` (string vacío → null, "60" → 60, "-5" → -5).
 * El use case se encarga de validar:
 *   - DRAFT only
 *   - duración en [1, 600] o null
 *
 * Si es null/"" → resetea al cálculo heurístico (totalQuestions *
 * DEFAULT_MINUTES_PER_QUESTION) — útil cuando el docente prefiere no
 * capturar duración manual.
 */
export async function saveEvaluationSettingsAction(
  evaluationId: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const raw = str(formData, "durationMinutes");
  let durationMinutes: number | null;
  if (raw === "") {
    durationMinutes = null;
  } else {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return { error: "La duración debe ser un número entero de minutos." };
    }
    durationMinutes = parsed;
  }

  const result = await makeUpdateEvaluationSettings().execute({
    actor,
    evaluationId,
    data: { durationMinutes },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}/settings`);
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}
