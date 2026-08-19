import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { institutionIdFromPath } from "@/modules/uploads/domain/upload";

/**
 * GET /api/uploads/evaluations/{institutionId}/{id}.jpg — sirve una imagen
 * subida al contenido de una formulación.
 *
 * Requiere sesión y que la imagen pertenezca a la institución del usuario:
 * la ruta lleva el `institutionId`, así que basta compararlo sin ir a la BD.
 *
 * OJO — esta ruta NO es la que usa la impresión. El worker de PDF carga
 * `/print/...` con un token firmado en la query string, y las peticiones de
 * las imágenes serían aparte, sin sesión ni token. Por eso el print page
 * incrusta las imágenes como `data:` URI (ver modules/uploads/application/
 * inline-content-images.ts) en lugar de apuntar aquí.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const { path } = await params;
  const relative = path.join("/");

  const owner = institutionIdFromPath(relative);
  if (!owner || owner !== actor.institutionId) {
    // Mismo 404 para "no existe" y "es de otra institución": distinguirlos
    // revelaría qué imágenes tienen otros colegios.
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  try {
    const buf = await localStorage.read(relative);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        // Inmutable: el nombre es un UUID, una imagen editada es otra subida.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }
}
