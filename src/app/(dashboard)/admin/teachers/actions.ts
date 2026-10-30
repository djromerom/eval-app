"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { parseTeacherImport } from "@/modules/teachers/infrastructure/import-parser";
import type { TeacherImportError } from "@/modules/teachers/application/teachers";
import {
  makeAssignTeacher,
  makeCompleteTeacherProfile,
  makeCreateTeacher,
  makeImportTeachers,
  makeRemoveTeacherAssignment,
  makeResendTeacherInvitation,
  makeUpdateTeacherAssignment,
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
  // Tipo de cuadernillo: vacío = la asignación aplica a cualquier tipo
  // (mismo valor de las filas creadas antes del sprint de tipos).
  const bookletTypeId = str(formData, "bookletTypeId");
  const result = await makeAssignTeacher().execute({
    actor,
    teacherId: str(formData, "teacherId"),
    courseId: str(formData, "courseId"),
    courseSubjectId: str(formData, "courseSubjectId"),
    bookletTypeId: bookletTypeId || null,
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

/** Resultado de editar el tipo de cuadernillo de una asignación. */
export interface UpdateAssignmentResult {
  ok: boolean;
  error?: string;
}

/**
 * Cambia el tipo de cuadernillo de una asignación docente ↔ asignatura-grado.
 *
 * Es una action suelta (no `useActionState`) porque la consume el drawer
 * derecho de la fila del docente: cada fila guarda su propio estado y solo
 * necesita el ok/error de vuelta.
 */
export async function updateTeacherAssignmentAction(
  assignmentId: string,
  bookletTypeId: string | null,
): Promise<UpdateAssignmentResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeUpdateTeacherAssignment().execute({
    actor,
    assignmentId,
    bookletTypeId,
  });
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Agrega una asignación docente ↔ asignatura-grado desde el drawer de la
 * fila del docente.
 *
 * Reusa `AssignTeacher` (mismas validaciones que el form de alta de la
 * página): el drawer solo cambia el "dónde" se hace, no las reglas.
 */
export async function addTeacherAssignmentAction(
  teacherId: string,
  courseId: string,
  courseSubjectId: string,
  bookletTypeId: string | null,
): Promise<UpdateAssignmentResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeAssignTeacher().execute({
    actor,
    teacherId,
    courseId,
    courseSubjectId,
    bookletTypeId,
  });
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/** Elimina una asignación docente ↔ asignatura-grado desde el drawer. */
export async function removeTeacherAssignmentAction(
  assignmentId: string,
): Promise<UpdateAssignmentResult> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeRemoveTeacherAssignment().execute({ actor, assignmentId });
  if (!result.ok) return { ok: false, error: result.error.message };
  revalidatePath(PATH);
  return { ok: true };
}

// ============= Import masivo (XLSX/CSV) =============
export interface TeachersImportState {
  error?: string;
  done?: boolean;
  total?: number;
  created?: number;
  failed?: number;
  errors?: TeacherImportError[];
}

/**
 * Importación masiva de docentes vía XLSX/CSV. Reusa el flujo de bienvenida
 * individual (token URL + email de invitación) por cada fila válida.
 */
export async function importTeachersAction(
  _prev: TeachersImportState,
  formData: FormData,
): Promise<TeachersImportState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona un archivo XLSX o CSV." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: "El archivo excede 5 MB." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseTeacherImport(buffer, file.name);
  if (parsed.error) return { error: parsed.error };
  if (parsed.missing.length > 0) {
    return { error: `Faltan columnas: ${parsed.missing.join(", ")}.` };
  }

  const institution = await prisma.institution.findUnique({
    where: { id: actor.institutionId },
    select: { name: true },
  });

  const result = await makeImportTeachers().execute({
    actor,
    rows: parsed.rows,
    institutionName: institution?.name ?? "Institución",
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(PATH);
  return {
    done: true,
    total: result.value.total,
    created: result.value.created,
    failed: result.value.failed,
    errors: result.value.errors,
  };
}
