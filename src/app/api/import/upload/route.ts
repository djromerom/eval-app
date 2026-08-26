import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/session";
import { makeEnqueueQuestionImport } from "@/modules/question-import/infrastructure/container";
import { errorResponse, unauthorizedResponse, validationResponse } from "@/app/api/_lib/domain-error";

/**
 * POST /api/import/upload — endpoint de subida de PDF para importación IA.
 *
 * Recibe un `multipart/form-data` con el PDF y opcionalmente un
 * `evaluationId` destino. El server action (`enqueueAiImportAction`) es el
 * camino principal desde la UI; este endpoint existe para integraciones
 * externas (CLI, scripts del admin, futuros Power-Uploaders desde Drive).
 *
 * Devuelve `{ jobId }` para que el cliente abra el SSE
 * (`/api/import/{jobId}/stream`).
 *
 * El procesamiento vive en un worker BullMQ aparte — esta ruta solo encola
 * y se libera rápido. Mantiene el server Next responsive aunque varios
 * docentes suban PDFs a la vez (ver plan
 * `wobbly-questing-fiddle.md`).
 */
export async function POST(request: Request) {
  const actor = await getAuthenticatedUser();
  if (!actor) return unauthorizedResponse();
  if (!actor.roles.includes("TEACHER") && !actor.roles.includes("ECU_LIDER")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Rol requerido: TEACHER o COORDINATOR." } },
      { status: 403 },
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return validationResponse("Body inválido (multipart requerido).");

  const file = form.get("file");
  if (!(file instanceof File)) return validationResponse("Falta el archivo.");

  const evaluationIdRaw = form.get("evaluationId");
  const evaluationId =
    typeof evaluationIdRaw === "string" && evaluationIdRaw.trim() ? evaluationIdRaw.trim() : null;

  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await makeEnqueueQuestionImport().execute({
    actor,
    file: buffer,
    fileName: file.name,
    evaluationId,
  });
  if (!result.ok) return errorResponse(result.error);

  // 202 Accepted: el job está encolado, todavía no procesado. El cliente
  // abre el SSE para enterarse del progreso.
  return NextResponse.json({ jobId: result.value.jobId }, { status: 202 });
}