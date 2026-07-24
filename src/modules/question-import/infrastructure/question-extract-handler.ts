/**
 * Manejador puro (sin BullMQ) del job de extracción. Se invoca desde
 * `workers/question-extract.worker.ts` y desde los tests unitarios. Solo
 * lee del storage institucional, ejecuta `saber-extractor`, sube las
 * figuras y actualiza el `QuestionImportJob`.
 *
 * Devuelve la cantidad de preguntas extraídas para que el caller (worker)
 * la registre en el `returnvalue` de BullMQ.
 */
import { makeUploadImageForInstitution } from "./docx-upload";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import type {
  QuestionExtractJob,
  QuestionExtractSseEvent,
} from "../domain/question-import-queue";
import type {
  QuestionImportJobRepository,
  QuestionImportJobSnapshot,
} from "../domain/question-import-job";
import { parseQuestionsFromPdf } from "./saber-extractor-parser";
import type { ParseResult } from "../domain/parsed-question";

export interface QuestionExtractHandlerDeps {
  repo: QuestionImportJobRepository;
}

export async function runQuestionExtract(
  payload: QuestionExtractJob,
  deps: QuestionExtractHandlerDeps,
): Promise<{ questionsCount: number; warningsCount: number }> {
  const { repo } = deps;
  const existing = await repo.findById(payload.institutionId, payload.jobId);
  if (!existing) {
    throw new Error(`QuestionImportJob ${payload.jobId} no existe en la institución.`);
  }

  await repo.setStatus(payload.jobId, "PROCESSING");
  await repo.setProgress(payload.jobId, { phase: "queued" });

  // Cargamos el PDF del storage institucional.
  let pdfBytes: Buffer;
  try {
    pdfBytes = await localStorage.read(existing.pdfRelativePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await repo.setStatus(payload.jobId, "FAILED", `No se pudo leer el PDF del storage: ${msg}`);
    throw err;
  }

  const uploadImage = makeUploadImageForInstitution();

  try {
    const result: ParseResult = await parseQuestionsFromPdf({
      buffer: pdfBytes,
      institutionId: payload.institutionId,
      uploadImage,
      onProgress: async (progress) => {
        // onProgress de saber-extractor ya viene con nuestro subset de fases
        // (ver `saber-extractor-parser.ts`). Persistimos + emitimos cada paso
        // para que la UI vea avance aún si el SSE se rehidrata tarde.
        await repo.setProgress(payload.jobId, progress);
      },
    });

    await repo.setResult(payload.jobId, result.questions, result.warnings);
    return {
      questionsCount: result.questions.length,
      warningsCount: result.warnings.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await repo.setStatus(payload.jobId, "FAILED", msg);
    throw err;
  }
}

/**
 * Helper para el endpoint SSE: serializa el estado actual de un job a la
 * forma de evento que consume la UI. Si el job ya está `DONE`/`FAILED`,
 * emite el evento terminal; si sigue `QUEUED`/`PROCESSING`, devuelve `null`
 * para que el caller siga propagando progreso por otra vía (BullMQ events).
 */
export function snapshotToSseEvent(
  record: QuestionImportJobSnapshot,
): QuestionExtractSseEvent | null {
  if (record.status === "DONE") {
    return {
      type: "done",
      questions: record.result,
      warnings: record.warnings,
    };
  }
  if (record.status === "FAILED") {
    return {
      type: "error",
      error: record.errorMessage ?? "La extracción falló.",
    };
  }
  return null;
}

/**
 * Helper para el endpoint SSE: traduce el último progreso persistido en BD
 * a un evento `progress` (p. ej. al rehidratar tras un refresh). Devuelve
 * `null` si todavía no hay fase registrada.
 */
export function snapshotProgressToSseEvent(
  record: QuestionImportJobSnapshot,
): QuestionExtractSseEvent["progress"] | null {
  if (!record.progressPhase) return null;
  // Reconstruimos el sub-tipo de QuestionExtractProgress a partir de la fila.
  // `progressDone`/`progressOf` están en columnas separadas (no en JSON) para
  // permitir queries SQL sobre el avance, así que los rehidratamos aquí.
  switch (record.progressPhase) {
    case "queued":
      return { phase: "queued" };
    case "split":
      return {
        phase: "split",
        totalPages: 0,
        chunks: record.progressOf ?? 0,
      };
    case "extract":
      return {
        phase: "extract",
        chunk: record.progressDone ?? 0,
        of: record.progressOf ?? 0,
        pages: [],
      };
    case "extract-done":
      return {
        phase: "extract-done",
        questions: record.progressDone ?? 0,
        contexts: record.progressOf ?? 0,
        missing: [],
      };
    case "solve":
      return {
        phase: "solve",
        solved: record.progressDone ?? 0,
        of: record.progressOf ?? 0,
      };
    case "images":
      return {
        phase: "images",
        done: record.progressDone ?? 0,
        of: record.progressOf ?? 0,
      };
    case "uploading":
      return {
        phase: "uploading",
        figuresDone: record.progressDone ?? 0,
        of: record.progressOf ?? 0,
      };
    case "assemble":
      return {
        phase: "assemble",
        questions: record.progressDone ?? 0,
      };
    default:
      return null;
  }
}