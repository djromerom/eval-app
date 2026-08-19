import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/session";
import { makeQuestionImportJobRepo } from "@/modules/question-import/infrastructure/container";

/**
 * GET /api/import/[jobId] — snapshot plano del estado de un job.
 *
 * Complementa al SSE `/stream`: cuando el cliente refresca la página o
 * vuelve después de cerrar la pestaña, el EventSource pierde la conexión
 * y no puede re-suscribirse limpiamente. Esta ruta devuelve el último
 * estado persistido en BD para que la UI pueda re-hidratar sin SSE.
 *
 * Devuelve:
 *  - `{ status: "QUEUED" | "PROCESSING", progressPhase, progressDone, progressOf }`
 *    si el job sigue corriendo.
 *  - `{ status: "DONE", questions, warnings }` si terminó OK.
 *  - `{ status: "FAILED", errorMessage }` si falló.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const actor = await getAuthenticatedUser();
  if (!actor) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  if (!actor.roles.includes("TEACHER") && !actor.roles.includes("ECU_LIDER")) {
    return NextResponse.json({ error: "Rol requerido." }, { status: 403 });
  }

  const { jobId } = await params;
  const snapshot = await makeQuestionImportJobRepo().findById(actor.institutionId, jobId);
  if (!snapshot) {
    return NextResponse.json({ error: "Job no encontrado." }, { status: 404 });
  }

  // Proyección mínima: la UI usa `status` para branchear y el resto como
  // datos de display. No exponemos `pdfRelativePath` ni `uploadedById` por
  // contener PII y rutas internas.
  switch (snapshot.status) {
    case "DONE":
      return NextResponse.json({
        status: "DONE",
        questions: snapshot.result,
        warnings: snapshot.warnings,
      });
    case "FAILED":
      return NextResponse.json({
        status: "FAILED",
        error: snapshot.errorMessage ?? "La extracción falló.",
      });
    case "QUEUED":
    case "PROCESSING":
      return NextResponse.json({
        status: snapshot.status,
        progressPhase: snapshot.progressPhase,
        progressDone: snapshot.progressDone,
        progressOf: snapshot.progressOf,
      });
  }
}