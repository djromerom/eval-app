import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeAddEvaluationToBundle } from "@/modules/bundles/infrastructure/container";
import {
  errorResponse,
  unauthorizedResponse,
  validationResponse,
} from "../../../_lib/domain-error";
import { addItemSchema } from "../../_schemas";

/**
 * POST /api/bundles/[id]/items — añade una evaluation al compendio.
 * Acceso: SUPER_ADMIN. Solo si DRAFT.
 * Body: { evaluationId, order? }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const { id: bundleId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = addItemSchema.safeParse(raw);
  if (!parsed.success) {
    return validationResponse(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const result = await makeAddEvaluationToBundle().execute({
    actor,
    bundleId,
    data: parsed.data,
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value }, { status: 201 });
}
