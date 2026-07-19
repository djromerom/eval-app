"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { Result } from "@/shared/domain/result";
import {
  makeCreateAcademicYear,
  makeCreateCourse,
  makeCreateCourseSubject,
  makeCreateGroup,
  makeCreatePeriod,
  makeCreateSubject,
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
