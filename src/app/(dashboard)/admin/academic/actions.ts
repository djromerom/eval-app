"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import type { Result } from "@/shared/domain/result";
import {
  makeCreateAcademicYear,
  makeCreateCourse,
  makeCreateCourseSubject,
  makeCreateGroup,
  makeCreatePeriod,
  makeCreateSubject,
  makeDeleteCourseSubject,
  makeDeleteGroup,
  makeDeletePeriod,
  makeUpdatePeriod,
} from "@/modules/academic/infrastructure/container";

export interface FormState {
  error?: string;
  success?: boolean;
}

const PATH = "/admin/academic";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function finish(result: Result<unknown>): FormState {
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function createAcademicYearAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeCreateAcademicYear().execute({
    actor,
    data: {
      year: Number(str(formData, "year")),
      startDate: new Date(str(formData, "startDate")),
      endDate: new Date(str(formData, "endDate")),
      isCurrent: formData.get("isCurrent") === "on",
    },
  });
  return finish(result);
}

export async function createPeriodAction(_p: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeCreatePeriod().execute({
    actor,
    data: {
      academicYearId: str(formData, "academicYearId"),
      name: str(formData, "name"),
      order: Number(str(formData, "order")),
      startDate: new Date(str(formData, "startDate")),
      endDate: new Date(str(formData, "endDate")),
    },
  });
  return finish(result);
}

/**
 * Edita un periodo desde el drawer de Fase 11.
 *
 * Recibe campos opcionales (solo se actualizan los presentes). El academicYearId
 * no se puede cambiar aquí; si el form lo trae, lo ignoramos.
 *
 * Tras éxito, redirige de vuelta al índice para refrescar la lista y cerrar
 * el drawer (el back del navegador funciona gracias a la URL independiente).
 */
export async function updatePeriodAction(_p: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const periodId = str(formData, "periodId");
  const nameRaw = str(formData, "name");
  const orderRaw = str(formData, "order");
  const startRaw = str(formData, "startDate");
  const endRaw = str(formData, "endDate");

  const data: {
    name?: string;
    order?: number;
    startDate?: Date;
    endDate?: Date;
  } = {};
  if (nameRaw) data.name = nameRaw;
  if (orderRaw) {
    const n = Number(orderRaw);
    if (Number.isInteger(n)) data.order = n;
  }
  if (startRaw) data.startDate = new Date(startRaw);
  if (endRaw) data.endDate = new Date(endRaw);

  const result = await makeUpdatePeriod().execute({ actor, periodId, data });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  redirect(PATH);
}

/**
 * Elimina un periodo desde el drawer. Tras éxito, redirige al índice.
 */
export async function deletePeriodAction(_p: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const periodId = str(formData, "periodId");
  const result = await makeDeletePeriod().execute({ actor, periodId });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  redirect(PATH);
}

export async function createCourseAction(_p: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeCreateCourse().execute({
    actor,
    data: {
      academicYearId: str(formData, "academicYearId"),
      name: str(formData, "name"),
      code: str(formData, "code"),
    },
  });
  return finish(result);
}

export async function createSubjectAction(_p: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeCreateSubject().execute({
    actor,
    data: { name: str(formData, "name"), code: str(formData, "code") },
  });
  return finish(result);
}

export async function createGroupAction(_p: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeCreateGroup().execute({
    actor,
    data: { courseId: str(formData, "courseId"), name: str(formData, "name") },
  });
  return finish(result);
}

/** Elimina un grupo desde la card del curso (Fase 11). */
export async function deleteGroupAction(_p: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const groupId = str(formData, "groupId");
  const result = await makeDeleteGroup().execute({ actor, groupId });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function createCourseSubjectAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeCreateCourseSubject().execute({
    actor,
    data: { courseId: str(formData, "courseId"), subjectId: str(formData, "subjectId") },
  });
  return finish(result);
}

/** Desenlaza una asignatura de un curso desde la card del curso (Fase 11). */
export async function deleteCourseSubjectAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const courseSubjectId = str(formData, "courseSubjectId");
  const result = await makeDeleteCourseSubject().execute({ actor, courseSubjectId });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}
