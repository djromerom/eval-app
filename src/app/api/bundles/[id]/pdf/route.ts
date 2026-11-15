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
 * GET /api/bundles/[id]/pdf — encola un job al worker PDF para que genere
 * el booklet del cuadernillo (kind = "bundle") y devuelve el archivo.
 *
 * Sprint 1: solo el booklet combinado (kind = "bundle"). La hoja de respuestas
 * unificada entra en Sprint 2 como kind = "answer-sheets-bundle".
 *
 * Requiere que el bundle esté en estado READY (READY == sellado). Verifica
 * también que pertenezca a la institución del actor.
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
      kind: "bundle",
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
      "Content-Disposition": `attachment; filename="${id}-bundle.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
