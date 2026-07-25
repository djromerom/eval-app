import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeReorderBundleItems } from "@/modules/bundles/infrastructure/container";
import {
  errorResponse,
  unauthorizedResponse,
  validationResponse,
} from "../../../../_lib/domain-error";
import { reorderItemsSchema } from "../../../_schemas";

/**
 * PATCH /api/bundles/[id]/items/reorder — reordena los items del cuadernillo.
 * Acceso: SUPER_ADMIN. Solo si DRAFT.
 * Body: { itemIds: string[] } — el orden de la lista ES el nuevo orden.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const { id: bundleId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = reorderItemsSchema.safeParse(raw);
  if (!parsed.success) {
    return validationResponse(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const result = await makeReorderBundleItems().execute({
    actor,
    bundleId,
    itemIds: parsed.data.itemIds,
  });
  if (!result.ok) return errorResponse(result.error);
  return new NextResponse(null, { status: 204 });
}
