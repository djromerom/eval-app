"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeCreateInstitution,
  makeSetInstitutionActive,
} from "@/modules/institutions/infrastructure/container";

export interface CreateInstitutionState {
  error?: string;
  success?: boolean;
}

/** Server action del formulario de alta (useActionState). Solo SUPER_ADMIN. */
export async function createInstitutionAction(
  _prev: CreateInstitutionState,
  formData: FormData,
): Promise<CreateInstitutionState> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");

  const data = {
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim(),
  };
  if (!data.name || !data.slug || !data.code) {
    return { error: "Nombre, slug y código son obligatorios." };
  }

  const result = await makeCreateInstitution().execute({ actor, data });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/institutions");
  return { success: true };
}

/** Server action de activar/desactivar (form action por fila). */
export async function toggleInstitutionActiveAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");

  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("isActive") === "true";

  const result = await makeSetInstitutionActive().execute({ actor, id, isActive });
  if (!result.ok) throw new Error(result.error.message);

  revalidatePath("/admin/institutions");
}
