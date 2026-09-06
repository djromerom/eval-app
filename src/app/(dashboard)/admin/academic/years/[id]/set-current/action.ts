"use server";

import { revalidatePath } from "next/cache";

import { requireAuthenticatedUser } from "@/lib/session";
import { makeSetCurrentAcademicYear } from "@/modules/academic/infrastructure/container";
import {
  ForbiddenError as DomainForbiddenError,
  NotFoundError as DomainNotFoundError,
} from "@/shared/domain/result";

export interface ActionResult {
  ok?: boolean;
  error?: string;
}

/**
 * Server action que marca un año académico como "actual" de la institución.
 * Firma `(prevState, formData)` para encajar con `useActionState` de React 19
 * (mismo patrón que `setCurrentPeriodAction` en el módulo de periodos).
 *
 * El use case hace no-op si el año ya está marcado como actual — el admin
 * puede volver a la página sin problema.
 */
export async function setCurrentAcademicYearAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const academicYearId = (formData.get("academicYearId") as string | null)?.trim() ?? "";

  if (!academicYearId) {
    return { ok: false, error: "Falta el identificador del año académico." };
  }

  const r = await makeSetCurrentAcademicYear().execute({ actor, academicYearId });
  if (r.ok) {
    revalidatePath("/admin/academic");
    return { ok: true };
  }

  const e = r.error;
  if (e instanceof DomainNotFoundError) {
    return { ok: false, error: e.message };
  }
  if (e instanceof DomainForbiddenError) {
    return { ok: false, error: e.message };
  }
  return { ok: false, error: e.message };
}
