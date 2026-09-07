"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeCreateBundle,
  makeDeleteBundle,
  makeMarkBundleReady,
  makeUnmarkBundleReady,
  makeUpdateBundle,
} from "@/modules/bundles/infrastructure/container";

export interface BundleFormState {
  error?: string;
  success?: boolean;
}

/**
 * Crea un cuadernillo. Usado por el wizard /admin/bundles/new.
 * Tras éxito redirige a la página de detalle.
 */
export async function createBundleAction(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const name = String(formData.get("name") ?? "").trim();
  const bookletNumberRaw = String(formData.get("bookletNumber") ?? "").trim();
  const evaluationIds = formData.getAll("evaluationIds").map(String).filter(Boolean);
  // "" en el select = cuadernillo cross-course (sin curso asignado).
  const courseId = String(formData.get("courseId") ?? "").trim() || null;
  // "" en el select de Prueba = dejar que el use case inyecte el periodo actual del año
  // académico vigente (default). Si el form manda un uuid, se usa como-is.
  const periodIdRaw = String(formData.get("periodId") ?? "").trim();
  const periodId: string | undefined = periodIdRaw === "" ? undefined : periodIdRaw;
  // "" en el select de Tipo = sin tipo. El use case no inyecta default aquí.
  const bookletTypeIdRaw = String(formData.get("bookletTypeId") ?? "").trim();
  const bookletTypeId: string | undefined = bookletTypeIdRaw === "" ? undefined : bookletTypeIdRaw;

  if (!name) return { error: "El nombre es obligatorio." };
  if (evaluationIds.length === 0) {
    return { error: "Selecciona al menos una formulación aprobada o publicada." };
  }

  const bookletNumber = bookletNumberRaw === "" ? null : Number(bookletNumberRaw);
  if (bookletNumber !== null && (!Number.isFinite(bookletNumber) || bookletNumber <= 0)) {
    return { error: "El número de cuadernillo debe ser un entero positivo." };
  }

  const result = await makeCreateBundle().execute({
    actor,
    data: {
      name,
      bookletNumber,
      courseId,
      periodId,
      bookletTypeId,
      evaluationIds,
    },
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/bundles");
  redirect(`/admin/bundles/${result.value.id}`);
}

/** Edita metadatos del cuadernillo (name, bookletNumber, courseId). Solo DRAFT. */
export async function updateBundleAction(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const bookletNumberRaw = String(formData.get("bookletNumber") ?? "").trim();
  const bookletNumber = bookletNumberRaw === "" ? null : Number(bookletNumberRaw);
  if (bookletNumber !== null && (!Number.isFinite(bookletNumber) || bookletNumber <= 0)) {
    return { error: "El número de cuadernillo debe ser un entero positivo." };
  }
  if (!name) return { error: "El nombre es obligatorio." };
  // "" en el select = limpiar el curso (cuadernillo cross-course).
  const courseId = String(formData.get("courseId") ?? "").trim() || null;
  // "" en el select = limpiar la Prueba / Tipo. El use case trata `null` como
  // "limpiar" (a diferencia de CreateBundle donde `undefined` resuelve el default).
  const periodId = String(formData.get("periodId") ?? "").trim() || null;
  const bookletTypeId = String(formData.get("bookletTypeId") ?? "").trim() || null;

  const result = await makeUpdateBundle().execute({
    actor,
    bundleId: id,
    data: { name, bookletNumber, courseId, periodId, bookletTypeId },
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/bundles");
  revalidatePath(`/admin/bundles/${id}`);
  return { success: true };
}

/** Sella / desella el cuadernillo. */
export async function toggleBundleReadyAction(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("next") ?? "");

  const result =
    next === "READY"
      ? await makeMarkBundleReady().execute({ actor, bundleId: id })
      : await makeUnmarkBundleReady().execute({ actor, bundleId: id });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/bundles");
  revalidatePath(`/admin/bundles/${id}`);
  return { success: true };
}

/** Elimina un cuadernillo en DRAFT. */
export async function deleteBundleAction(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const id = String(formData.get("id") ?? "");

  const result = await makeDeleteBundle().execute({ actor, bundleId: id });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/bundles");
  redirect("/admin/bundles");
}
