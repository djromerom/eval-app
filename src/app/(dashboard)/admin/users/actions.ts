"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AuthenticatedUser, Role } from "@/shared/application/authenticated-user";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { ADMIN_ASSIGNABLE_ROLES } from "@/modules/users/domain/user";
import {
  makeInviteUser,
  makeResendUserInvitation,
  makeSetUserActive,
  makeSetUserRoles,
} from "@/modules/users/infrastructure/container";
import { makeEnsureTeacherProfile } from "@/modules/teachers/infrastructure/container";

const PATH = "/admin/users";
const TEACHERS_PATH = "/admin/teachers";

/**
 * El rol Profesor implica un perfil docente: si se asigna desde Usuarios, se crea
 * un perfil incompleto (sin documento) para que aparezca en el módulo Docentes,
 * donde se completa. Quitar el rol no borra el perfil.
 */
async function ensureTeacherProfileIfNeeded(
  actor: AuthenticatedUser,
  userId: string,
  roles: Role[],
) {
  if (!roles.includes("TEACHER")) return;
  await makeEnsureTeacherProfile().execute({ actor, userId });
  revalidatePath(TEACHERS_PATH);
}

async function institutionNameOf(institutionId: string): Promise<string> {
  const inst = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { name: true },
  });
  return inst?.name ?? "Institución";
}

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
  // Permitimos ECU_MASTER y SUPER_ADMIN. Solo SUPER_ADMIN verá el selector
  // de institución en el form; el ECU_MASTER siempre cae a su institución.
  const actor = await requireAuthenticatedUser("ECU_MASTER", "SUPER_ADMIN");
  const roles = rolesFrom(formData);
  // `targetInstitutionId` viene del select solo si actor es SUPER_ADMIN.
  // Si un ECU_MASTER lo manda por cualquier vía, el use case lo rechaza.
  const targetInstitutionId = String(formData.get("targetInstitutionId") ?? "").trim() || undefined;
  const result = await makeInviteUser().execute({
    actor,
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    roles,
    institutionName: await institutionNameOf(targetInstitutionId ?? actor.institutionId),
    targetInstitutionId,
  });
  if (!result.ok) return { error: result.error.message };
  await ensureTeacherProfileIfNeeded(actor, result.value.id, roles);
  revalidatePath(PATH);
  return { success: true };
}

export async function resendUserInvitationAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeResendUserInvitation().execute({
    actor,
    userId: String(formData.get("userId") ?? ""),
    institutionName: await institutionNameOf(actor.institutionId),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function setUserRolesAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const userId = String(formData.get("userId") ?? "");
  const roles = rolesFrom(formData);
  const result = await makeSetUserRoles().execute({ actor, userId, roles });
  if (!result.ok) return { error: result.error.message };
  await ensureTeacherProfileIfNeeded(actor, userId, roles);
  revalidatePath(PATH);
  return { success: true };
}

export async function setUserActiveAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeSetUserActive().execute({
    actor,
    userId: String(formData.get("userId") ?? ""),
    isActive: formData.get("isActive") === "true",
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(PATH);
}
