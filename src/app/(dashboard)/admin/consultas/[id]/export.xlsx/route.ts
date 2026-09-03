/**
 * Route handler GET para descargar el listado filtrado como XLSX.
 *
 * URL:  GET /admin/consultas/<id>/export.xlsx?search=…&subject=…&year=…&status=…
 *      (los query params son opcionales; si no vienen, se exportan TODAS las filas)
 * Auth: requiere sesión con capability `run-queries` (ECU_MASTER / SUPER_ADMIN).
 *       El gate del padre (`/[id]/page.tsx`) ya filtra por rol; aquí se duplica
 *       porque los route handlers son entry-points independientes.
 *
 * Decisión de diseño — por qué re-correr el use case en lugar de aceptar
 * un payload del cliente: el cliente nunca pasa datos de filas al server
 * (vector de ataque + ancho de banda). El server es la única fuente de
 * verdad para los datos, los filtros son solo "qué subset ver".
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuthenticatedUser } from "@/lib/session";
import { can } from "@/shared/application/capabilities";
import {
  applyFormulacionesFilters,
  parseFormulacionesFilters,
} from "@/modules/consultas/domain/queries/formulaciones/filters";
import { formulacionRowsToWorksheet } from "@/modules/consultas/domain/shared/xlsx-formatter";
import { makeListFormulaciones } from "@/modules/consultas/infrastructure/container";

export const dynamic = "force-dynamic"; // siempre fresco; no cachear

function buildFilename(actor: { institutionId: string }): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `formulaciones-${actor.institutionId}-${today}.xlsx`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER");
  if (!can("run-queries", actor.roles)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  if (id !== "formulaciones") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const filters = parseFormulacionesFilters({
    search: req.nextUrl.searchParams.get("search") ?? undefined,
    subjectName: req.nextUrl.searchParams.get("subject") ?? undefined,
    courseName: req.nextUrl.searchParams.get("course") ?? undefined,
    academicYearYear: req.nextUrl.searchParams.get("year") ?? undefined,
    status: req.nextUrl.searchParams.get("status") ?? undefined,
  });

  const res = await makeListFormulaciones().execute({ actor });
  if (!res.ok) {
    return NextResponse.json({ error: res.error.code }, { status: 500 });
  }
  const rows = applyFormulacionesFilters(res.value, filters);

  const buffer = formulacionRowsToWorksheet(rows);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${buildFilename(actor)}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
}
