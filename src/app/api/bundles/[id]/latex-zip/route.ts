/**
 * GET /api/bundles/[id]/latex-zip — descarga el cuadernillo como ZIP LaTeX.
 *
 * URL:   GET /api/bundles/<bundleId>/latex-zip
 * Auth:  requiere capability `manage-bundles` (SUPER_ADMIN / ECU_MASTER /
 *        ECU_LIDER). El use case vuelve a forzar el scoping por rol
 *        defensivamente, así que un TEACHER aquí recibe 403.
 *
 * Por qué SÍNCRONO (no BullMQ como `pdf/route.ts`):
 *   - Tamaño esperado: ~10-50 KB de .tex × 50 evaluations = ~2.5 MB;
 *     imágenes con cap 8 MB. Bien dentro del body limit.
 *   - Latencia dominada por `localStorage.read()` × imágenes (~10 ms c/u
 *     en disco SSD), muy por debajo del route timeout de 30 s.
 *   - Si un caso patológico excede timeout, se escala a BullMQ.
 *     Hoy es dramáticamente más simple ir síncrono.
 *
 * Patrón replicado de `admin/consultas/[id]/export.xlsx/route.ts` (XLSX):
 *   - GET síncrono → `use case.execute(...)` → Buffer → NextResponse con
 *     `Content-Type` + `Content-Disposition` + `Content-Length` + `no-store`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { can } from "@/shared/application/capabilities";
import { makeBuildLatexZip } from "@/modules/latex-export/infrastructure/container";
import { errorResponse } from "@/app/api/_lib/domain-error";

export const dynamic = "force-dynamic"; // siempre fresco; no cachear

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // 1. Auth + capability check. La nav de admin ya filtra por rol pero los
  //    route handlers son entry-points independientes (pueden venir de un
  //    curl, de un enlace compartido, etc.) — duplicamos el gate aquí.
  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER", "ECU_LIDER");
  if (!can("manage-bundles", actor.roles)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 2. Resolver `id` (Next 15 params es Promise).
  const { id } = await params;

  // 3. Ejecutar el use case. `requireRole` interno valida el rol de nuevo
  //    como defensa en profundidad; los DomainError se mapean a HTTP vía
  //    `errorResponse`.
  const res = await makeBuildLatexZip().execute({
    actor,
    mode: "bundle",
    targetId: id,
  });
  if (!res.ok) {
    return errorResponse(res.error);
  }

  // 4. Devolver el ZIP. `Buffer` se serializa via `Uint8Array` (Node 22+
  //    acepta Buffer directo, pero Uint8Array es el tipo portable).
  return new NextResponse(new Uint8Array(res.value.zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${res.value.filename}"`,
      "Content-Length": String(res.value.zipBuffer.length),
      "Cache-Control": "no-store",
    },
  });
}
