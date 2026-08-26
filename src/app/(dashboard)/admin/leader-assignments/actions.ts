"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import {
  makeAssignLeader,
  makeUnassignLeader,
} from "@/modules/leader-assignments/infrastructure/container";

const PATH = "/admin/leader-assignments";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Asigna un usuario con rol ECU_LIDER a un curso de la institución. */
export async function assignLeaderAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeAssignLeader().execute({
    actor,
    userId: str(formData, "userId"),
    courseId: str(formData, "courseId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

/** Quita la asignación de un líder a un curso. Idempotente. */
export async function unassignLeaderAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeUnassignLeader().execute({
    actor,
    userId: str(formData, "userId"),
    courseId: str(formData, "courseId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

/** Wrapper de 1 argumento para usar como `action={...}` directamente en un <form>
 *  (el action del form pasa solo FormData, no el prev state). El EntityForm
 *  de admin/leader-assignments ya envuelve con prev → este wrapper es para
 *  el botón "Quitar" de la tabla, que no necesita estado. */
export async function unassignLeaderFormAction(formData: FormData): Promise<void> {
  await unassignLeaderAction({}, formData);
}