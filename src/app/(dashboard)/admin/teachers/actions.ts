"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import { prisma } from "@/shared/infrastructure/db/prisma";
import {
  makeAssignTeacher,
  makeCompleteTeacherProfile,
  makeCreateTeacher,
  makeResendTeacherInvitation,
} from "@/modules/teachers/infrastructure/container";

const PATH = "/admin/teachers";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createTeacherAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const institution = await prisma.institution.findUnique({
    where: { id: actor.institutionId },
    select: { name: true },
  });
  const result = await makeCreateTeacher().execute({
    actor,
    institutionName: institution?.name ?? "Institución",
    data: {
      name: str(formData, "name"),
      email: str(formData, "email"),
      idType: str(formData, "idType"),
      idNumber: str(formData, "idNumber"),
      phone: str(formData, "phone") || undefined,
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function resendTeacherInvitationAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const institution = await prisma.institution.findUnique({
    where: { id: actor.institutionId },
    select: { name: true },
  });
  const result = await makeResendTeacherInvitation().execute({
    actor,
    teacherId: str(formData, "teacherId"),
    institutionName: institution?.name ?? "Institución",
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function completeTeacherProfileAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeCompleteTeacherProfile().execute({
    actor,
    teacherId: str(formData, "teacherId"),
    idType: str(formData, "idType"),
    idNumber: str(formData, "idNumber"),
    phone: str(formData, "phone") || undefined,
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function assignTeacherAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeAssignTeacher().execute({
    actor,
    teacherId: str(formData, "teacherId"),
    courseSubjectId: str(formData, "courseSubjectId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}
