"use server";

import { revalidatePath } from "next/cache";

import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeCreateBookletType,
  makeDeleteBookletType,
} from "@/modules/booklet-types/infrastructure/container";
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
  ok: boolean;
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
