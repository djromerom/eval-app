import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import {
  type PdfGenerationJob,
  type PdfGenerationResult,
  getPdfGenerationQueue,
  getPdfQueueEvents,
} from "@/shared/infrastructure/queue/queues";

/** Espera máxima por el job del worker PDF (configurable: PDF_QUEUE_WAIT_MS). */
const WAIT_MS = env.PDF_QUEUE_WAIT_MS;

/**
 * GET /api/bundles/[id]/pdf-linear — encola un job al worker PDF para que
 * genere el cuadernillo completo en formato page-by-page (kind =
 * "bundle-linear"), una página carta por hoja lógica. Sin imposition
 * saddle-stitch: el usuario configura booklet imposition desde el driver
 * de su impresora sobre pliego tabloid apaisado.
 *
 * Mismo control de acceso que `/api/bundles/[id]/pdf`: requiere sesión
 * TEACHER/COORDINADOR/ADMIN, bundle READY y pertenencia a la institución.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER", "SUPER_ADMIN");
  const { id } = await params;

  const bundleRes = await makeGetBundle().execute({ actor, bundleId: id });
  if (!bundleRes.ok) {
    return NextResponse.json({ error: "Cuadernillo no encontrado." }, { status: 404 });
  }
  if (bundleRes.value.status !== "READY") {
    return NextResponse.json(
      { error: "El cuadernillo debe estar marcado como READY antes de imprimir." },
      { status: 409 },
    );
  }

  const job = await getPdfGenerationQueue().add(
    "pdf",
    {
      bundleId: id,
      institutionId: actor.institutionId,
      kind: "bundle-linear",
      // La ruta /print/bundle/[id] detecta `linear=1` y renderiza la portada
      // como `.sheet.cover` (8.5×11) en vez de `.sheet.cover-sheet` (17×11).
      // El worker aplica un único render lineal sin imposition.
      extraQuery: "linear=1",
    } satisfies PdfGenerationJob,
    { removeOnComplete: true, removeOnFail: 50 },
  );

  let result: PdfGenerationResult;
  try {
    result = (await job.waitUntilFinished(getPdfQueueEvents(), WAIT_MS)) as PdfGenerationResult;
  } catch {
    return NextResponse.json(
      { error: "No se pudo generar el PDF. Verifica que el worker esté activo." },
      { status: 504 },
    );
  }

  const file = await readFile(result.path);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${id}-bundle-linear.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
