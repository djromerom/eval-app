import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeUpdateEvaluationSettings } from "@/modules/evaluations/infrastructure/container";
import {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from "@/modules/evaluations/domain/evaluation";

const settingsSchema = z.object({
  // Nullable: null resetea al cálculo heurístico (totalQuestions * DEFAULT_MINUTES_PER_QUESTION).
  // Entero en [MIN_DURATION_MINUTES, MAX_DURATION_MINUTES] (1..600).
  durationMinutes: z.number().int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES).nullable(),
});

/**
 * Sprint 7 — edición de los campos de Settings de la evaluation.
 * Hoy solo `durationMinutes`. Validación: entero en [1, 600] o null.
 * Estado: solo DRAFT (lo enforza el use case `UpdateEvaluationSettings`,
 * que devuelve VALIDATION si la evaluation está APPROVED o PUBLISHED).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const { id } = await params;

  const raw = await request.json().catch(() => null);
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await makeUpdateEvaluationSettings().execute({
    actor,
    evaluationId: id,
    data: parsed.data,
  });
  if (!result.ok) {
    const status =
      result.error.code === "NOT_FOUND" ? 404 : result.error.code === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json({
    id: result.value.id,
    durationMinutes: result.value.durationMinutes,
  });
}
