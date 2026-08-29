"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import { makeChangeEvaluationStatus } from "@/modules/evaluations/infrastructure/container";

const PATH = "/coordinator/review";

async function transition(evaluationId: string, to: "APPROVED" | "PUBLISHED") {
  const actor = await requireAuthenticatedUser("ECU_LIDER");
  const result = await makeChangeEvaluationStatus().execute({ actor, evaluationId, to });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(PATH);
}

export async function approveAction(formData: FormData): Promise<void> {
  await transition(String(formData.get("evaluationId") ?? ""), "APPROVED");
}

export async function publishAction(formData: FormData): Promise<void> {
  await transition(String(formData.get("evaluationId") ?? ""), "PUBLISHED");
}

/** Revierte una formulación PUBLICADA a DRAFT sin pedir comentario (rollback).
 *  Sprint ago 2026: el coordinador usa este botón desde la sección
 *  "Publicadas" del módulo de revisión cuando necesita hacer ajustes
 *  posteriores. La transición `PUBLISHED → DRAFT` para ECU_LIDER no
 *  requiere comentario (no es un rechazo formal). */
export async function revertAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("ECU_LIDER");
  const result = await makeChangeEvaluationStatus().execute({
    actor,
    evaluationId: String(formData.get("evaluationId") ?? ""),
    to: "DRAFT",
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(PATH);
}

export async function rejectAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("ECU_LIDER");
  const result = await makeChangeEvaluationStatus().execute({
    actor,
    evaluationId: String(formData.get("evaluationId") ?? ""),
    to: "DRAFT",
    comment: String(formData.get("comment") ?? "").trim(),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(PATH);
  return { success: true };
}
