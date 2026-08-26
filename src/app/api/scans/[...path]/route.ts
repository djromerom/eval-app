import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";

/**
 * GET /api/scans/<institutionId>/scans/<batchId>/<file>.png — sirve una
 * imagen escaneada o el overlay PNG generado por el worker OMR.
 *
 * Convención de ruta:
 *   `scans/<institutionId>/scans/<batchId>/sheet_<id>.png`
 *   `scans/<institutionId>/scans/<batchId>/sheet_<id>_overlay.png`
 *
 * Tenant check por convención de path (mismo patrón que `/api/uploads`):
 * el primer segmento después de `scans/` es el `institutionId`. Si no
 * coincide con la institución del usuario → 404 (mismo status para "no
 * existe" y "de otra institución" para no filtrar existencia a colegios
 * ajenos).
 *
 * Los nombres de archivo son UUIDs del worker → cacheamos con
 * `immutable`. Los overlays se regeneran en cada reprocess, pero el
 * nombre del sheet es estable: el overlay es "v1" del sheet, no del
 * reprocess, así que también es inmutable desde la perspectiva del
 * cliente (cualquier reprocess genera una NUEVA ruta con id distinto en
 * `processedImage`).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const { path } = await params;
  const relative = path.join("/");

  const parts = relative.split("/");
  if (parts.length < 4 || parts[0] !== "scans") {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }
  const owner = parts[1];
  if (!owner || owner !== actor.institutionId) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }

  try {
    const buf = await localStorage.read(relative);
    const ext = relative.toLowerCase().endsWith(".png") ? "png" : "jpg";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": ext === "png" ? "image/png" : "image/jpeg",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  }
}
