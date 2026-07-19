import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import type { PrintKind } from "@/shared/infrastructure/crypto/print-token";
import {
  type PdfGenerationJob,
  type PdfGenerationResult,
  getPdfGenerationQueue,
  getPdfQueueEvents,
} from "@/shared/infrastructure/queue/queues";

const KINDS: Array<Exclude<PrintKind, "bundle" | "answer-sheets-bundle" | "answer-key-bundle">> = [
  "booklet",
  "answer-sheets",
  "answer-key",
];
const WAIT_MS = 90_000;

/**
 * Descarga del PDF de una evaluación (cartilla, hojas o clave). Encola un job de
 * generación server-side y espera a que el worker lo complete, luego transmite
 * el archivo. Requiere el worker PDF corriendo (pnpm worker:pdf).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR", "ECU_MASTER");
  const { id } = await params;

  const kindParam = new URL(request.url).searchParams.get("kind") ?? "booklet";
  if (!KINDS.includes(kindParam as (typeof KINDS)[number])) {
    return NextResponse.json({ error: "Tipo de PDF inválido." }, { status: 400 });
  }
  const kind = kindParam as (typeof KINDS)[number];

  // Verifica que la evaluación exista y pertenezca a la institución del actor.
  const evalRes = await makeGetEvaluation().execute({ actor, id });
  if (!evalRes.ok) {
    return NextResponse.json({ error: "Evaluación no encontrada." }, { status: 404 });
  }

  const job = await getPdfGenerationQueue().add(
    "pdf",
    { evaluationId: id, institutionId: actor.institutionId, kind } satisfies PdfGenerationJob,
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
      "Content-Disposition": `attachment; filename="${id}-${kind}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
