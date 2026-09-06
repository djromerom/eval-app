"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import type { ImportError } from "@/modules/students/domain/student";
import {
  makeCreateStudent,
  makeDeleteStudent,
  makeImportStudents,
  makeUpdateStudent,
} from "@/modules/students/infrastructure/container";
import { parseStudentsImport } from "@/modules/students/infrastructure/import-parser";

const PATH = "/admin/students";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createStudentAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeCreateStudent().execute({
    actor,
    data: {
      groupId: str(formData, "groupId"),
      lastName1: str(formData, "lastName1"),
      lastName2: str(formData, "lastName2"),
      firstName1: str(formData, "firstName1"),
      firstName2: str(formData, "firstName2"),
      idType: str(formData, "idType"),
      idNumber: str(formData, "idNumber"),
      code: str(formData, "code"),
      enrollmentYear: Number(str(formData, "enrollmentYear")),
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

/**
 * Edita un estudiante desde el drawer (Fase 12). Tras éxito redirige a la
 * página principal — el formulario vive en `/admin/students/[id]/edit`.
 *
 * NO edita el código: `code` tiene su propio flujo (`ChangeStudentCode`)
 * con historial. Si en el form viene `studentId`, lo extrae del hidden
 * field.
 */
export async function updateStudentAction(
  _p: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeUpdateStudent().execute({
    actor,
    studentId: str(formData, "studentId"),
    data: {
      groupId: str(formData, "groupId"),
      lastName1: str(formData, "lastName1"),
      lastName2: str(formData, "lastName2"),
      firstName1: str(formData, "firstName1"),
      firstName2: str(formData, "firstName2"),
      idType: str(formData, "idType"),
      idNumber: str(formData, "idNumber"),
      enrollmentYear: Number(str(formData, "enrollmentYear")),
      isActive: formData.get("isActive") === "on",
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  redirect(PATH);
}

/**
 * Soft-delete: marca deletedAt y desactiva. Tras éxito redirige a la página
 * principal (el usuario verá la fila desaparecer del listado).
 */
export async function deleteStudentAction(
  _p: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeDeleteStudent().execute({
    actor,
    studentId: str(formData, "studentId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  redirect(PATH);
}

export interface ImportState {
  error?: string;
  created?: number;
  errors?: ImportError[];
  done?: boolean;
}

/** Importación masiva: recibe el archivo XLSX o CSV, lo parsea y lo procesa. */
export async function importStudentsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona un archivo XLSX o CSV." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: "El archivo excede 5 MB." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseStudentsImport(buffer, file.name);
  if (parsed.error) return { error: parsed.error };
  if (parsed.missing.length > 0) {
    return { error: `Faltan columnas en el archivo: ${parsed.missing.join(", ")}.` };
  }

  const result = await makeImportStudents().execute({ actor, rows: parsed.rows });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(PATH);
  return { done: true, created: result.value.created, errors: result.value.errors };
}
