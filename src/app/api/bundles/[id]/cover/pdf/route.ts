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
 * GET /api/bundles/[id]/cover/pdf — encola un job al worker PDF para que
 * genere SOLO la portada del cuadernillo (kind = "cover-bundle", 1 página
 * carta) y devuelve el archivo.
 *
 * Sirve al botón "Descargar PDF" del editor /cover-html: el docente puede
 * previsualizar la portada actual sin necesidad de marcar el bundle como
 * READY ni esperar al cuadernillo completo (que incluye booklet + hoja de
 * respuestas).
 *
 * NO requiere READY — funciona con DRAFT, READY o PUBLISHED. La portada es
 * solo lectura, no mutación.
 *
 * Requiere que el bundle pertenezca a la institución del actor.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER", "SUPER_ADMIN");
  const { id } = await params;

  const bundleRes = await makeGetBundle().execute({ actor, bundleId: id });
  if (!bundleRes.ok) {
    return NextResponse.json({ error: "Cuadernillo no encontrado." }, { status: 404 });
  }

  const job = await getPdfGenerationQueue().add(
    "pdf",
    {
      bundleId: id,
      institutionId: actor.institutionId,
      kind: "cover-bundle",
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
      "Content-Disposition": `attachment; filename="${id}-cover.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
