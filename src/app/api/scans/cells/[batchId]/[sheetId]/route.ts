import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";

/**
 * GET /api/scans/cells/<batchId>/<sheetId>
 *
 * Sirve el JSON de detección por hoja (`{thr, questions:[{n,ans,fills,crop}]}`)
 * que persiste el worker OMR (`ProcessAnswerSheet.persistCells`) para alimentar
 * la matriz de revisión (recortes + fills por celda). El tenant-check consulta
 * la hoja por institución con el mismo patrón que el resto de scan/*: o es de
 * una evaluación del docente actual, o de un compendio de su institución.
 * Cualquier fallo → 404 (no filtra existencia a colegios ajenos).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string; sheetId: string }> },
) {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR", "ECU_MASTER");
  const { batchId, sheetId } = await params;

  const sheet = await prisma.answerSheet.findFirst({
    where: {
      id: sheetId,
      scanBatchId: batchId,
      OR: [
        { evaluation: { institutionId: actor.institutionId } },
        { bundle: { institutionId: actor.institutionId } },
      ],
    },
    select: { id: true },
  });
  if (!sheet) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  try {
    const rel = `scans/${batchId}/sheet_${sheetId.slice(0, 8)}_cells.json`;
    const buf = await localStorage.read(rel);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // El diagnóstico de una hoja no cambia salvo reprocess (nueva llamada
        // manual); cache corto en el cliente para navegar la matriz fluido.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }
}
