"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { Role } from "@/shared/application/authenticated-user";
import { ADMIN_ASSIGNABLE_ROLES } from "@/modules/users/domain/user";
import {
  makeInviteUser,
  makeSetUserActive,
  makeSetUserRoles,
} from "@/modules/users/infrastructure/container";

const PATH = "/admin/users";

export interface UserFormState {
  error?: string;
  success?: boolean;
}

function rolesFrom(formData: FormData): Role[] {
  const assignable = new Set<string>(ADMIN_ASSIGNABLE_ROLES);
  return formData
    .getAll("roles")
    .map(String)
    .filter((r): r is Role => assignable.has(r));
}

export async function inviteUserAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const actor = await requireAuthenticatedUser("ADMIN");
  const result = await makeInviteUser().execute({
    actor,
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    roles: rolesFrom(formData),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function setUserRolesAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const actor = await requireAuthenticatedUser("ADMIN");
  const result = await makeSetUserRoles().execute({
    actor,
    userId: String(formData.get("userId") ?? ""),
    roles: rolesFrom(formData),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function setUserActiveAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("ADMIN");
  const result = await makeSetUserActive().execute({
    actor,
    userId: String(formData.get("userId") ?? ""),
    isActive: formData.get("isActive") === "true",
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(PATH);
}
