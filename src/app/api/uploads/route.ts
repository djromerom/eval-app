import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAuthenticatedUser } from "@/lib/session";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { MAX_UPLOAD_BYTES, UPLOAD_MIME, uploadRelativePath } from "@/modules/uploads/domain/upload";

/**
 * POST /api/uploads — sube una imagen para el contenido de una formulación
 * (contextos y enunciados) y devuelve la URL con la que referenciarla.
 *
 * La imagen se normaliza con sharp antes de guardarla: las fotos de celular
 * llegan a 4000px y 3 MB, y se imprimen a ~8 cm de ancho. Reducirlas a 1200px
 * no cambia nada visible en papel y sí importa en el PDF, donde cada imagen
 * viaja incrustada en base64 (+33% sobre el binario).
 *
 * El archivo queda bajo `evaluations/{institutionId}/`, de modo que la ruta
 * lleva el tenant y el GET puede comprobar que quien lee pertenece a él.
 */
export async function POST(request: Request) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  }
  if (!UPLOAD_MIME.has(file.type)) {
    return NextResponse.json({ error: "Solo PNG, JPG o WEBP." }, { status: 415 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Imagen demasiado grande (máx ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` },
      { status: 413 },
    );
  }

  const original = Buffer.from(await file.arrayBuffer());
  let processed: Buffer;
  try {
    processed = await normalizeImage(original);
  } catch {
    // sharp falla con un archivo cuyo MIME dice imagen pero no lo es.
    return NextResponse.json({ error: "El archivo no es una imagen válida." }, { status: 415 });
  }

  const relative = uploadRelativePath(actor.institutionId, randomUUID());
  await localStorage.save(relative, processed);

  return NextResponse.json({ url: `/api/uploads/${relative}` }, { status: 201 });
}

/** Reduce a lo ancho/alto máximo y recodifica a JPEG de calidad razonable. */
async function normalizeImage(input: Buffer): Promise<Buffer> {
  return (
    sharp(input)
      // `withoutEnlargement` evita reescalar hacia arriba una imagen pequeña,
      // que solo añadiría peso sin ganar detalle.
      .rotate() // respeta la orientación EXIF de las fotos de celular
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
  );
}
