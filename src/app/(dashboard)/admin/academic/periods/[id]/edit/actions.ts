"use server";

import { revalidatePath } from "next/cache";

import { requireAuthenticatedUser } from "@/lib/session";
import { makeSetCurrentPeriod } from "@/modules/academic/infrastructure/container";
import {
  makeCreateBookletType,
  makeDeleteBookletType,
} from "@/modules/booklet-types/infrastructure/container";
import {
  makeCreateEvaluationRule,
  makeDeleteEvaluationRule,
  makeUpdateEvaluationRule,
} from "@/modules/evaluation-rules/infrastructure/container";
import {
  ValidationError as DomainValidationError,
  ConflictError as DomainConflictError,
  NotFoundError as DomainNotFoundError,
  ForbiddenError as DomainForbiddenError,
} from "@/shared/domain/result";

/**
 * Server actions para gestionar tipos de cuadernillo desde el drawer de
 * edición de prueba (Fase 11 — ago 2026).
 *
 * Patrón idéntico a las acciones de periodos (update/delete) que ya
 * existen en este módulo: `revalidatePath` para refrescar el listado y
 * `redirect` opcional cuando la operación cierra el formulario.
 */

interface ActionResult {
  ok?: boolean;
  id?: string;
  error?: string;
  field?: string;
}

function mapError(code: string, message: string, field?: string): ActionResult {
  return { ok: false, error: message, field };
}

export async function createBookletTypeAction(
  periodId: string,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const description = (formData.get("description") as string | null)?.trim() || undefined;

  const r = await makeCreateBookletType().execute({
    actor,
    periodId,
    data: { name, description },
  });

  if (r.ok) {
    revalidatePath(`/admin/academic/periods/${periodId}/edit`);
    return { ok: true };
  }

  const e = r.error;
  if (e instanceof DomainValidationError) {
    return mapError("VALIDATION", e.message, "name");
  }
  if (e instanceof DomainConflictError) {
    return mapError("CONFLICT", e.message, "name");
  }
  if (e instanceof DomainNotFoundError) {
    return mapError("NOT_FOUND", e.message);
  }
  if (e instanceof DomainForbiddenError) {
    return mapError("FORBIDDEN", e.message);
  }
  return mapError("UNKNOWN", e.message);
}

export async function deleteBookletTypeAction(
  periodId: string,
  bookletTypeId: string,
): Promise<ActionResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const r = await makeDeleteBookletType().execute({
    actor,
    id: bookletTypeId,
  });

  if (r.ok) {
    revalidatePath(`/admin/academic/periods/${periodId}/edit`);
    return { ok: true };
  }

  const e = r.error;
  if (e instanceof DomainNotFoundError) {
    return mapError("NOT_FOUND", e.message);
  }
  if (e instanceof DomainForbiddenError) {
    return mapError("FORBIDDEN", e.message);
  }
  return mapError("UNKNOWN", e.message);
}

/**
 * Marca (o desmarca) una Prueba como "actual" dentro de su año académico.
 * Firma `(prevState, formData)` para encajar con `useActionState` de
 * React 19 (mismo patrón que `updatePeriodAction` / `deletePeriodAction`
 * ya existentes).
 */
export async function setCurrentPeriodAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const periodId = (formData.get("periodId") as string | null)?.trim() ?? "";
  const isCurrentRaw = (formData.get("isCurrent") as string | null) ?? "false";
  const isCurrent = isCurrentRaw === "true";

  if (!periodId) {
    return mapError("VALIDATION", "Falta el identificador de la prueba.");
  }

  const r = await makeSetCurrentPeriod().execute({ actor, periodId, isCurrent });
  if (r.ok) {
    revalidatePath("/admin/academic");
    revalidatePath(`/admin/academic/periods/${periodId}/edit`);
    return { ok: true };
  }

  const e = r.error;
  if (e instanceof DomainNotFoundError) {
    return mapError("NOT_FOUND", e.message);
  }
  if (e instanceof DomainForbiddenError) {
    return mapError("FORBIDDEN", e.message);
  }
  return mapError("UNKNOWN", e.message);
}

// ===========================================================================
// Reglas de conteo exacto (ago 2026 — Sprint módulo evaluation-rules)
// ===========================================================================

/**
 * Server actions que envuelven los use cases `Create/Update/Delete
 * EvaluationRule`. Mismo patrón que los de BookletType de arriba:
 * - Valida role (ECU_MASTER) en el use case.
 * - Mapea errores de dominio → `ActionResult` para mostrar inline en el
 *   `EvaluationRulesManager` (admin drawer).
 * - `revalidatePath` para refrescar el drawer tras mutación.
 */

function parseExactQuestions(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : NaN;
}

export async function createEvaluationRuleAction(
  periodId: string,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const courseId = (formData.get("courseId") as string | null)?.trim() ?? "";
  const subjectId = (formData.get("subjectId") as string | null)?.trim() ?? "";
  const bookletTypeId = (formData.get("bookletTypeId") as string | null)?.trim() ?? "";
  const exactRaw = parseExactQuestions(formData.get("exactQuestions"));

  if (!courseId || !subjectId || !bookletTypeId || !Number.isFinite(exactRaw)) {
    return mapError(
      "VALIDATION",
      "Faltan datos obligatorios (grado, asignatura, tipo de cuadernillo, conteo exacto).",
    );
  }

  const r = await makeCreateEvaluationRule().execute({
    actor,
    data: {
      periodId,
      courseId,
      subjectId,
      bookletTypeId,
      exactQuestions: exactRaw as number,
    },
  });

  if (r.ok) {
    revalidatePath(`/admin/academic/periods/${periodId}/edit`);
    return { ok: true, id: r.value.id };
  }

  const e = r.error;
  if (e instanceof DomainValidationError) {
    return mapError("VALIDATION", e.message);
  }
  if (e instanceof DomainConflictError) {
    return mapError("CONFLICT", e.message);
  }
  if (e instanceof DomainNotFoundError) {
    return mapError("NOT_FOUND", e.message);
  }
  if (e instanceof DomainForbiddenError) {
    return mapError("FORBIDDEN", e.message);
  }
  return mapError("UNKNOWN", e.message);
}

export async function updateEvaluationRuleAction(
  periodId: string,
  ruleId: string,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const exactRaw = parseExactQuestions(formData.get("exactQuestions"));

  if (!Number.isFinite(exactRaw)) {
    return mapError("VALIDATION", "El conteo exacto debe ser un entero entre 1 y 500.");
  }

  const r = await makeUpdateEvaluationRule().execute({
    actor,
    id: ruleId,
    data: { exactQuestions: exactRaw as number },
  });

  if (r.ok) {
    revalidatePath(`/admin/academic/periods/${periodId}/edit`);
    return { ok: true };
  }

  const e = r.error;
  if (e instanceof DomainValidationError) {
    return mapError("VALIDATION", e.message);
  }
  if (e instanceof DomainNotFoundError) {
    return mapError("NOT_FOUND", e.message);
  }
  if (e instanceof DomainForbiddenError) {
    return mapError("FORBIDDEN", e.message);
  }
  return mapError("UNKNOWN", e.message);
}

export async function deleteEvaluationRuleAction(
  periodId: string,
  ruleId: string,
): Promise<ActionResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const r = await makeDeleteEvaluationRule().execute({ actor, id: ruleId });

  if (r.ok) {
    revalidatePath(`/admin/academic/periods/${periodId}/edit`);
    return { ok: true };
  }

  const e = r.error;
  if (e instanceof DomainNotFoundError) {
    return mapError("NOT_FOUND", e.message);
  }
  if (e instanceof DomainForbiddenError) {
    return mapError("FORBIDDEN", e.message);
  }
  return mapError("UNKNOWN", e.message);
}
