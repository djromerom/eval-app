"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeToggleDisabledBundleQuestion } from "@/modules/bundles/infrastructure/container";
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/domain/result";

export type ToggleDisabledQuestionCode =
  "LOCKED_SCAN" | "LAST_EFFECTIVE" | "NOT_IN_BUNDLE" | "NOT_FOUND" | "FORBIDDEN" | "UNKNOWN";

export interface ToggleDisabledQuestionState {
  /** Mensaje listo para mostrar al usuario. */
  error?: string;
  /** Código semántico para que la UI ramifique el copy contextual. */
  code?: ToggleDisabledQuestionCode;
  /** ID de la pregunta involucrada — útil para scroll/highlight en la UI. */
  questionId?: string;
}

/**
 * Toggle desde el panel DisabledQuestionsManager (PR #3 del sprint
 * Preguntas inhabitadas, sep 2026).
 *
 * Mapea los `DomainError` que devuelve el use case `ToggleDisabledBundleQuestion`
 * a códigos estables. La UI no hace `indexOf` sobre strings — matchea por
 * `code` y muestra el copy apropiado:
 *
 *   - `LOCKED_SCAN`: ya hay hojas escaneadas, no se puede togglear.
 *     La UI muestra este error como banner global (afecta a todo el bundle).
 *   - `LAST_EFFECTIVE`: la inhabitación dejaría al bundle con 0 preguntas
 *     efectivas. Error contextual a la fila.
 *   - `NOT_IN_BUNDLE`: la pregunta no pertenece al bundle (data drift /
 *     race condition). Error contextual a la fila.
 *   - `NOT_FOUND` / `FORBIDDEN` / `UNKNOWN`: errores defensivos.
 *
 * Decisión: usamos regex sobre `e.message` (no refactorizamos el use case)
 * porque los mensajes son contrato estable cubierto por tests existentes
 * (`toggle-disabled-bundle-question.test.ts`).
 */
export async function toggleDisabledQuestionAction(
  bundleId: string,
  questionId: string,
  disabled: boolean,
): Promise<ToggleDisabledQuestionState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  if (!bundleId || !questionId) {
    return { code: "UNKNOWN", error: "Faltan datos.", questionId };
  }

  const result = await makeToggleDisabledBundleQuestion().execute({
    actor,
    bundleId,
    questionId,
    disabled,
  });

  if (result.ok) {
    revalidatePath(`/admin/bundles/${bundleId}`);
    return {};
  }

  const e = result.error;
  if (e instanceof NotFoundError) {
    return { code: "NOT_FOUND", error: e.message, questionId };
  }
  if (e instanceof ForbiddenError) {
    return { code: "FORBIDDEN", error: e.message, questionId };
  }
  if (e instanceof ValidationError) {
    if (/escaneadas/i.test(e.message)) {
      return { code: "LOCKED_SCAN", error: e.message, questionId };
    }
    if (/al menos una pregunta efectiva/i.test(e.message)) {
      return { code: "LAST_EFFECTIVE", error: e.message, questionId };
    }
    if (/no pertenece a este cuadernillo/i.test(e.message)) {
      return { code: "NOT_IN_BUNDLE", error: e.message, questionId };
    }
    return { code: "UNKNOWN", error: e.message, questionId };
  }
  return { code: "UNKNOWN", error: e.message ?? "Error inesperado.", questionId };
}
