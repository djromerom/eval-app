import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
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
/** Espera máxima por el job del worker PDF (configurable: PDF_QUEUE_WAIT_MS). */
const WAIT_MS = env.PDF_QUEUE_WAIT_MS;

/**
 * Descarga del PDF de una formulación (cartilla, hojas o clave). Encola un job de
 * generación server-side y espera a que el worker lo complete, luego transmite
 * el archivo. Requiere el worker PDF corriendo (pnpm worker:pdf).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const { id } = await params;

  const kindParam = new URL(request.url).searchParams.get("kind") ?? "booklet";
  if (!KINDS.includes(kindParam as (typeof KINDS)[number])) {
    return NextResponse.json({ error: "Tipo de PDF inválido." }, { status: 400 });
  }
  const kind = kindParam as (typeof KINDS)[number];

  // sep 2026 — sprint "descargar de una": `students=<csv>` filtra la hoja
  // de respuestas a los IDs dados (solo aplica a `kind=answer-sheets`,
  // que se renderiza desde /print/bulk-answer-sheets y ya sabe filtrar).
  // Se pasa al worker como `extraQuery` para que Puppeteer lo concatene a
  // la URL (ver `pdf.worker.ts:159`). Sin `students`, el worker genera
  // hojas para todos los estudiantes activos de la institución.
  const studentsParam = new URL(request.url).searchParams.get("students");
  const extraQuery =
    kind === "answer-sheets" && studentsParam && studentsParam.length > 0
      ? `students=${encodeURIComponent(studentsParam)}`
      : undefined;

  // Verifica que la formulación exista y pertenezca a la institución del actor.
  const evalRes = await makeGetEvaluation().execute({ actor, id });
  if (!evalRes.ok) {
    return NextResponse.json({ error: "Formulación no encontrada." }, { status: 404 });
  }

  // Construimos el header persistente que el worker estampa con pdf-lib en
  // cada página: "ECU [GRADO] – [ASIGNATURA] [N° cuadernillo]". El
  // booklet (kind=booklet) es el único kind donde aplica — las hojas
  // de respuestas y la clave no llevan este header.
  const pageHeader =
    kind === "booklet"
      ? await (async () => {
          const csRes = await makeListCourseSubjects().execute({ actor });
          const cs = csRes.ok
            ? csRes.value.find((c) => c.id === evalRes.value.courseSubjectId)
            : undefined;
          const grade = cs?.courseName ?? "";
          const area = cs?.subjectName ?? "";
          const bookletLabel =
            evalRes.value.bookletNumber != null ? ` ${evalRes.value.bookletNumber}` : "";
          return `ECU ${grade} – ${area}${bookletLabel}`;
        })()
      : undefined;

  const job = await getPdfGenerationQueue().add(
    "pdf",
    {
      evaluationId: id,
      institutionId: actor.institutionId,
      kind,
      pageHeader,
      ...(extraQuery ? { extraQuery } : {}),
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
      "Content-Disposition": `attachment; filename="${id}-${kind}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
