import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeRemoveFromBundle } from "@/modules/bundles/infrastructure/container";
import { errorResponse, unauthorizedResponse } from "../../../../_lib/domain-error";

/**
 * DELETE /api/bundles/[id]/items/[itemId] — quita una evaluation del compendio.
 * Acceso: SUPER_ADMIN. Solo si DRAFT.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const { id: bundleId, itemId } = await params;
  const result = await makeRemoveFromBundle().execute({ actor, bundleId, itemId });
  if (!result.ok) return errorResponse(result.error);
  return new NextResponse(null, { status: 204 });
}
