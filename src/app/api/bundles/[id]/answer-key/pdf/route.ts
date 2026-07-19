import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import {
  type PdfGenerationJob,
  type PdfGenerationResult,
  getPdfGenerationQueue,
  getPdfQueueEvents,
} from "@/shared/infrastructure/queue/queues";

const WAIT_MS = 90_000;

/**
 * GET /api/bundles/[id]/answer-key/pdf — clave de respuestas unificada
 * (kind = "answer-key-bundle"). Sprint 3 del módulo compendios.
 * Requiere que el bundle esté READY.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser(
    "TEACHER",
    "COORDINATOR",
    "ECU_MASTER",
    "SUPER_ADMIN",
  );
  const { id } = await params;

  const bundleRes = await makeGetBundle().execute({ actor, bundleId: id });
  if (!bundleRes.ok) {
    return NextResponse.json({ error: "Compendio no encontrado." }, { status: 404 });
  }
  if (bundleRes.value.status !== "READY") {
    return NextResponse.json(
      { error: "El compendio debe estar marcado como READY antes de imprimir." },
      { status: 409 },
    );
  }

  const job = await getPdfGenerationQueue().add(
    "pdf",
    {
      bundleId: id,
      institutionId: actor.institutionId,
      kind: "answer-key-bundle",
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
      "Content-Disposition": `attachment; filename="${id}-answer-key-bundle.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
