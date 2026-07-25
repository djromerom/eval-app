import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeDeleteBundle,
  makeGetBundle,
  makeUpdateBundle,
} from "@/modules/bundles/infrastructure/container";
import { errorResponse, unauthorizedResponse, validationResponse } from "../../_lib/domain-error";
import { updateBundleSchema } from "../_schemas";

/**
 * GET /api/bundles/[id] — devuelve el detalle del cuadernillo (con items).
 * Acceso: cualquier rol autenticado de la misma institución.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const { id } = await params;
  const result = await makeGetBundle().execute({ actor, bundleId: id });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value });
}

/**
 * PATCH /api/bundles/[id] — actualiza name / bookletNumber / theme.
 * Acceso: SUPER_ADMIN. Solo si el bundle está en DRAFT.
 * Body: subset de UpdateBundleData.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const { id } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = updateBundleSchema.safeParse(raw);
  if (!parsed.success) {
    return validationResponse(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const result = await makeUpdateBundle().execute({ actor, bundleId: id, data: parsed.data });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value });
}

/**
 * DELETE /api/bundles/[id] — elimina el cuadernillo (cascade de items).
 * Acceso: SUPER_ADMIN. Solo si DRAFT.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const { id } = await params;
  const result = await makeDeleteBundle().execute({ actor, bundleId: id });
  if (!result.ok) return errorResponse(result.error);
  return new NextResponse(null, { status: 204 });
}
