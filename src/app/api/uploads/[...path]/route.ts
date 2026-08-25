import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { institutionIdFromPath } from "@/modules/uploads/domain/upload";

/**
 * GET /api/uploads/{namespace}/{institutionId}/{...path} — sirve una imagen
 * subida al contenido de una formulación o a un cover HTML live.
 *
 * Namespaces aceptados (ver `institutionIdFromPath`):
 *   • `evaluations/{institutionId}/...` — imágenes de contenido TipTap
 *     (`InlineContentImages` las persiste aquí).
 *   • `institutions/{institutionId}/cover-html/{bundleId}/...` — assets
 *     extraídos por `extractInlineAssets` (ago 2026).
 *
 * Requiere sesión y que la imagen pertenezca a la institución del usuario:
 * la ruta lleva el `institutionId`, así que basta compararlo sin ir a la BD.
 *
 * OJO — esta ruta NO es la que usa la impresión. El worker de PDF carga
 * `/print/...` con un token firmado en la query string, y las peticiones de
 * las imágenes serían aparte, sin sesión ni token. Por eso el print page
 * incrusta las imágenes como `data:` URI (ver modules/uploads/application/
 * inline-content-images.ts y modules/cover-html/application/inline-html-images.ts)
 * en lugar de apuntar aquí.
 */

/** MIME por extensión —agnóstico al namespace. Cubre los formatos que
 *  `extractInlineAssets` y `InlineContentImages` pueden guardar. */
function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

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
        "Content-Type": mimeForPath(relative),
        // Inmutable: el nombre es un UUID, una imagen editada es otra subida.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }
}
