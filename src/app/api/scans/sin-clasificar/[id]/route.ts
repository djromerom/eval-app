import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAuthenticatedUser } from "@/lib/session";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";

/**
 * GET /api/scans/sin-clasificar/<id>
 *
 * Imagen de una hoja sin clasificar, para la card del lote: sin ella no hay
 * cómo leer el nombre escrito en la hoja al elegir el estudiante. Se convierte
 * a JPEG porque los escaneos suelen ser .tif, que el navegador no muestra.
 * El tenant-check es contra la base, como en `/api/scans/file/...`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const { id } = await params;

  const hoja = await prisma.unclassifiedScan.findFirst({
    where: { id, institutionId: actor.institutionId },
    select: { filePath: true },
  });
  if (!hoja) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  try {
    const original = await localStorage.read(hoja.filePath);
    const jpeg = await sharp(original)
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }
}
