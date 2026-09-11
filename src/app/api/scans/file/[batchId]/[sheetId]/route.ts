import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";

/**
 * GET /api/scans/file/<batchId>/<sheetId>
 *
 * Descarga la imagen escaneada original de una hoja. Existe aparte de
 * `/api/scans/<...path>` porque aquella ruta valida el tenant por convención
 * de path (`scans/<institutionId>/...`) y los escaneos se guardan bajo
 * `scans/<batchId>/...`, sin el id de institución. Acá el tenant-check se hace
 * contra la base, igual que en `/api/scans/cells/...`.
 *
 * Responde con `Content-Disposition: attachment` y el nombre con el que el
 * usuario subió el archivo, que es lo que hace útil la descarga: permite
 * volver del registro al archivo que salió del escáner.
 */
const TIPOS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string; sheetId: string }> },
) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
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
    select: { scannedImage: true, originalFilename: true },
  });
  if (!sheet?.scannedImage) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  const guardado = sheet.scannedImage.split("/").pop() ?? "escaneo";
  // Los lotes anteriores a `originalFilename` solo tienen el nombre renombrado.
  const nombre = sheet.originalFilename ?? guardado;
  const ext = guardado.toLowerCase().split(".").pop() ?? "";

  try {
    const buf = await localStorage.read(sheet.scannedImage);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": TIPOS[ext] ?? "application/octet-stream",
        // El nombre va entre comillas y sin caracteres de control: llega de la
        // base y termina en una cabecera HTTP.
        "Content-Disposition": `attachment; filename="${nombre.replace(/["\r\n]/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }
}
