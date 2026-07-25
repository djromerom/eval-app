import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { prisma } from "@/shared/infrastructure/db/prisma";
import {
  type PdfGenerationJob,
  type PdfGenerationResult,
  getPdfGenerationQueue,
  getPdfQueueEvents,
} from "@/shared/infrastructure/queue/queues";

const WAIT_MS = 120_000;

/**
 * GET /api/bundles/[id]/answer-sheets/pdf?students=<csv> — genera la hoja
 * de respuestas UNIFICADA del cuadernillo (kind = "answer-sheets-bundle").
 * Si no se pasa `students`, devuelve error 400 (no hay a quién imprimirle).
 *
 * Sprint 2: solo se imprime si el bundle está READY. La query `students`
 * es un csv de ids de estudiantes de la misma institución.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser(
    "TEACHER",
    "COORDINATOR",
    "ECU_MASTER",
    "SUPER_ADMIN",
  );
  const { id } = await params;

  const studentsParam = new URL(request.url).searchParams.get("students") ?? "";
  const studentIds = studentsParam.split(",").filter(Boolean);
  if (studentIds.length === 0) {
    return NextResponse.json(
      { error: "Debes indicar al menos un estudiante (parámetro ?students=)." },
      { status: 400 },
    );
  }

  // Verifica que el bundle exista y esté READY.
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

  // Verifica que los estudiantes existan en la institución (no leak cross-tenant).
  const found = await prisma.student.findMany({
    where: { id: { in: studentIds }, institutionId: actor.institutionId },
    select: { id: true },
  });
  if (found.length !== studentIds.length) {
    return NextResponse.json(
      { error: "Uno o más estudiantes no existen en esta institución." },
      { status: 404 },
    );
  }

  const job = await getPdfGenerationQueue().add(
    "pdf",
    {
      bundleId: id,
      institutionId: actor.institutionId,
      kind: "answer-sheets-bundle",
      extraQuery: `students=${encodeURIComponent(studentsParam)}`,
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
      "Content-Disposition": `attachment; filename="${id}-answer-sheets-bundle.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
