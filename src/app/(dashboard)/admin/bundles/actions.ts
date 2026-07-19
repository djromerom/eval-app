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
 * Crea un compendio. Usado por el wizard /admin/bundles/new.
 * Tras éxito redirige a la página de detalle.
 */
export async function createBundleAction(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");

  const name = String(formData.get("name") ?? "").trim();
  const bookletNumberRaw = String(formData.get("bookletNumber") ?? "").trim();
  const evaluationIds = formData.getAll("evaluationIds").map(String).filter(Boolean);

  if (!name) return { error: "El nombre es obligatorio." };
  if (evaluationIds.length === 0) {
    return { error: "Selecciona al menos una evaluación aprobada o publicada." };
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
      evaluationIds,
    },
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/bundles");
  redirect(`/admin/bundles/${result.value.id}`);
}

/** Edita metadatos del compendio (name, bookletNumber). Solo DRAFT. */
export async function updateBundleAction(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const bookletNumberRaw = String(formData.get("bookletNumber") ?? "").trim();
  const bookletNumber = bookletNumberRaw === "" ? null : Number(bookletNumberRaw);
  if (bookletNumber !== null && (!Number.isFinite(bookletNumber) || bookletNumber <= 0)) {
    return { error: "El número de cuadernillo debe ser un entero positivo." };
  }
  if (!name) return { error: "El nombre es obligatorio." };

  const result = await makeUpdateBundle().execute({
    actor,
    bundleId: id,
    data: { name, bookletNumber },
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/bundles");
  revalidatePath(`/admin/bundles/${id}`);
  return { success: true };
}

/** Sella / desella el compendio. */
export async function toggleBundleReadyAction(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");
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

/** Elimina un compendio en DRAFT. */
export async function deleteBundleAction(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");
  const id = String(formData.get("id") ?? "");

  const result = await makeDeleteBundle().execute({ actor, bundleId: id });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/bundles");
  redirect("/admin/bundles");
}
