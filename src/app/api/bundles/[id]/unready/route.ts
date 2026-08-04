import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeUnmarkBundleReady } from "@/modules/bundles/infrastructure/container";
import { errorResponse, unauthorizedResponse } from "../../../_lib/domain-error";

/**
 * POST /api/bundles/[id]/unready — desella el cuadernillo (READY → DRAFT).
 * Acceso: SUPER_ADMIN.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const { id: bundleId } = await params;
  const result = await makeUnmarkBundleReady().execute({ actor, bundleId });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value });
}
