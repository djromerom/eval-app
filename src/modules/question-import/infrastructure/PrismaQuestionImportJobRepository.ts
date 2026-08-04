/**
 * Implementación Prisma de `QuestionImportJobRepository`.
 *
 * Solo Prisma vive en este archivo: ningún caller (use case, handler, SSE
 * route) debe tocar `@prisma/client` directamente. Mantiene el contrato del
 * repositorio en `domain/question-import-job.ts` (regla del repo, ver
 * eval-app/ARCHITECTURE.md).
 *
 * Decisiones de modelado:
 * - `resultJson` se guarda como `{ questions: ParsedQuestion[] }` para
 *   reservar la posibilidad de añadir metadata top-level (versión del
 *   pipeline, prompt usado) sin migrar el esquema.
 * - `warningsJson` se guarda como `string[]` directo.
 * - `bullJobId` es `@unique` a nivel BD → si alguien intenta crear dos filas
 *   con el mismo id de BullMQ, la BD lo rechaza (defensa en profundidad
 *   contra reintentos duplicados del action).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateQuestionImportJobInput,
  QuestionImportJobRepository,
  QuestionImportJobSnapshot,
  QuestionImportJobStatus,
} from "../domain/question-import-job";
import type { ParsedQuestion } from "../domain/parsed-question";
import type { QuestionExtractProgress } from "../domain/question-import-queue";

/** Serializa el subset de progreso que queremos exponer en la BD. */
function progressToRow(
  progress: QuestionExtractProgress,
): { progressPhase: string; progressDone: number | null; progressOf: number | null } {
  const { phase } = progress;
  switch (phase) {
    case "queued":
      return { progressPhase: "queued", progressDone: null, progressOf: null };
    case "split":
      return { progressPhase: "split", progressDone: null, progressOf: progress.chunks };
    case "extract":
      return { progressPhase: "extract", progressDone: progress.chunk, progressOf: progress.of };
    case "extract-done":
      return {
        progressPhase: "extract-done",
        progressDone: progress.questions,
        progressOf: progress.contexts,
      };
    case "solve":
      return { progressPhase: "solve", progressDone: progress.solved, progressOf: progress.of };
    case "images":
      return { progressPhase: "images", progressDone: progress.done, progressOf: progress.of };
    case "uploading":
      return {
        progressPhase: "uploading",
        progressDone: progress.figuresDone,
        progressOf: progress.of,
      };
    case "assemble":
      return { progressPhase: "assemble", progressDone: progress.questions, progressOf: null };
  }
}

function mapRow(row: {
  id: string;
  institutionId: string;
  uploadedById: string;
  evaluationId: string | null;
  status: string;
  pdfRelativePath: string;
  resultJson: Prisma.JsonValue | null;
  warningsJson: Prisma.JsonValue | null;
  errorMessage: string | null;
  bullJobId: string | null;
  progressPhase: string | null;
  progressDone: number | null;
  progressOf: number | null;
  createdAt: Date;
  updatedAt: Date;
}): QuestionImportJobSnapshot {
  // `resultJson` se persiste como `{ questions: ParsedQuestion[] }`. Si viene
  // null (job no terminado), exponemos un array vacío: la UI usa `status`
  // para saber si debe mostrarlo.
  let result: ParsedQuestion[] = [];
  if (row.resultJson && typeof row.resultJson === "object" && !Array.isArray(row.resultJson)) {
    const inner = (row.resultJson as { questions?: unknown }).questions;
    if (Array.isArray(inner)) result = inner as ParsedQuestion[];
  } else if (Array.isArray(row.resultJson)) {
    // Tolerancia hacia versiones anteriores que guardaban el array directo.
    result = row.resultJson as unknown as ParsedQuestion[];
  }

  const warnings: string[] = Array.isArray(row.warningsJson)
    ? (row.warningsJson as string[])
    : [];

  return {
    id: row.id,
    institutionId: row.institutionId,
    uploadedById: row.uploadedById,
    evaluationId: row.evaluationId,
    status: row.status as QuestionImportJobStatus,
    pdfRelativePath: row.pdfRelativePath,
    result,
    warnings,
    errorMessage: row.errorMessage,
    bullJobId: row.bullJobId,
    progressPhase: row.progressPhase,
    progressDone: row.progressDone,
    progressOf: row.progressOf,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaQuestionImportJobRepository implements QuestionImportJobRepository {
  async create(input: CreateQuestionImportJobInput): Promise<void> {
    await prisma.questionImportJob.create({
      data: {
        id: input.id,
        institutionId: input.institutionId,
        uploadedById: input.uploadedById,
        evaluationId: input.evaluationId,
        pdfRelativePath: input.pdfRelativePath,
        // Non-null a nivel dominio: `null` significaría "no encolado" y el
        // worker no podría mapear BD ↔ BullMQ para correlar logs/reintentos.
        bullJobId: input.bullJobId,
        status: "QUEUED",
      },
    });
  }

  async setBullJobId(id: string, bullJobId: string): Promise<void> {
    await prisma.questionImportJob.update({
      where: { id },
      data: { bullJobId },
    });
  }

  async findById(institutionId: string, id: string): Promise<QuestionImportJobSnapshot | null> {
    const row = await prisma.questionImportJob.findFirst({
      where: { id, institutionId },
    });
    return row ? mapRow(row) : null;
  }

  async setStatus(id: string, status: QuestionImportJobStatus, errorMessage?: string): Promise<void> {
    await prisma.questionImportJob.update({
      where: { id },
      data: {
        status,
        // Limpiamos `errorMessage` cuando pasamos a PROCESSING/DONE para no
        // arrastrar el error de un reintento anterior.
        errorMessage: status === "PROCESSING" || status === "DONE" ? null : errorMessage ?? null,
      },
    });
  }

  async setProgress(id: string, progress: QuestionExtractProgress): Promise<void> {
    await prisma.questionImportJob.update({
      where: { id },
      data: progressToRow(progress),
    });
  }

  async setResult(id: string, result: ParsedQuestion[], warnings: string[]): Promise<void> {
    await prisma.questionImportJob.update({
      where: { id },
      data: {
        status: "DONE",
        resultJson: { questions: result } as unknown as Prisma.InputJsonValue,
        warningsJson: warnings as unknown as Prisma.InputJsonValue,
        errorMessage: null,
      },
    });
  }
}