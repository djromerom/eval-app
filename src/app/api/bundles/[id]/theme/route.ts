import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeUpdateBundleTheme } from "@/modules/bundles/infrastructure/container";
import {
  errorResponse,
  unauthorizedResponse,
  validationResponse,
} from "../../../_lib/domain-error";
import { updateThemeSchema } from "../../_schemas";

/**
 * PATCH /api/bundles/[id]/theme — actualiza solo el theme del bundle.
 * Acceso: SUPER_ADMIN. Solo si DRAFT.
 * Body: { theme: any | null }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser().catch(() => null);
  if (!actor) return unauthorizedResponse();

  const { id: bundleId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = updateThemeSchema.safeParse(raw);
  if (!parsed.success) {
    return validationResponse(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const result = await makeUpdateBundleTheme().execute({
    actor,
    bundleId,
    theme: parsed.data.theme,
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ data: result.value });
}
