import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeCreateBundle, makeListBundles } from "@/modules/bundles/infrastructure/container";
import { errorResponse, unauthorizedResponse, validationResponse } from "../_lib/domain-error";
import { createBundleSchema } from "./_schemas";

/**
 * GET /api/bundles — lista los cuadernillos de la institución del actor.
 * Acceso: cualquier rol autenticado (coordinador/docente ven solo lectura;
 * la UI ya filtra las acciones de edición al SUPER_ADMIN).
 */
export async function GET() {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const result = await makeListBundles().execute({ actor });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value });
}

/**
 * POST /api/bundles — crea un cuadernillo en DRAFT.
 * Acceso: SUPER_ADMIN (verificado en el use case).
 * Body: { name, bookletNumber?, evaluationIds[], theme? }
 */
export async function POST(request: Request) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const raw = await request.json().catch(() => null);
  const parsed = createBundleSchema.safeParse(raw);
  if (!parsed.success) {
    return validationResponse(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const result = await makeCreateBundle().execute({ actor, data: parsed.data });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value }, { status: 201 });
}
