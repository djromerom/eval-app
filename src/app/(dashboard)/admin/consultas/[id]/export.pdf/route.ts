/**
 * Route handler GET para descargar el informe detallado por grupo como PDF.
 *
 * URL:  GET /admin/consultas/informe-grupo/export.pdf?prueba=<periodId>&grupo=<groupId>
 *       (ambos query params obligatorios).
 * Auth: requiere sesión con capability `run-queries`. Mismo gate que el XLSX
 *       (SUPER_ADMIN / ECU_MASTER / ECU_LIDER; el último acotado a sus grados
 *       por el use case).
 *
 * Pipeline: encola un job BullMQ `kind: "informe-grupo"` con periodId+groupId
 * y espera el resultado. El worker Puppeteer pide la página
 * `/print/informe-grupo/<periodId>/<groupId>?t=<token>` con un token firmado
 * HMAC (mismo patrón que `/api/bundles/[id]/pdf` y `/api/evaluations/[id]/pdf`).
 *
 * Re-corre el use case antes de encolar para devolver 403/404 sin malgastar
 * un job de BullMQ si la combinación no es válida (grupo fuera de alcance,
 * de otra institución, etc.).
 */
import { readFile } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/config/env";
import { requireAuthenticatedUser } from "@/lib/session";
import { can } from "@/shared/application/capabilities";
import {
  type PdfGenerationJob,
  type PdfGenerationResult,
  getPdfGenerationQueue,
  getPdfQueueEvents,
} from "@/shared/infrastructure/queue/queues";

export const dynamic = "force-dynamic"; // siempre fresco; no cachear

/** Espera máxima por el job del worker PDF (configurable: PDF_QUEUE_WAIT_MS). */
const WAIT_MS = env.PDF_QUEUE_WAIT_MS;

/** Nombre de archivo seguro: sin tildes, espacios ni separadores. */
function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

async function exportInformeGrupoPdf(req: NextRequest): Promise<Response> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER", "ECU_LIDER");
  if (!can("run-queries", actor.roles)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const periodId = req.nextUrl.searchParams.get("prueba") ?? "";
  const groupId = req.nextUrl.searchParams.get("grupo") ?? "";
  if (!periodId || !groupId) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const res = await (
    await import("@/modules/consultas/infrastructure/container")
  )
    .makeGetInformeGrupo()
    .execute({ actor, periodId, groupId });
  if (!res.ok) return NextResponse.json({ error: res.error.code }, { status: 403 });
  const { informe, error } = res.value;
  if (!informe) {
    const code = error?.code ?? "NOT_FOUND";
    const status = code === "FORBIDDEN" ? 403 : code === "VALIDATION" ? 400 : 404;
    return NextResponse.json({ error: code }, { status });
  }

  const job = await getPdfGenerationQueue().add(
    "pdf",
    {
      institutionId: actor.institutionId,
      periodId,
      groupId,
      kind: "informe-grupo",
      // El HTML del /print/informe-grupo ya renderiza el footer institucional
      // (fecha + institución) dentro de su `.footer`. El worker solo estampa
      // "Página X de Y" en la columna derecha (Chromium no exporta
      // `counter(pages)` en headless). Lo activa la rama
      // `job.data.pageFooter || isInformeGrupoKind` en pdf.worker.ts.
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
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="informe-grupo-${slug(informe.grupo.name)}-${slug(informe.prueba.name)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (id === "informe-grupo") return exportInformeGrupoPdf(req);
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
