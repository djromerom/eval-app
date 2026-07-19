import { ScanStatus } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  AnswerSheet,
  AnswerSheetStatus,
  ScanBatch,
  ScanBatchStatus,
  ScanningRepository,
  StudentAnswerRecord,
} from "../domain/answer-sheet";

const statusToPrisma: Record<AnswerSheetStatus | ScanBatchStatus, ScanStatus> = {
  PENDING: ScanStatus.PENDING,
  SCANNED: ScanStatus.SCANNED,
  PROCESSING: ScanStatus.PROCESSING,
  GRADED: ScanStatus.GRADED,
  REVIEW: ScanStatus.REVIEW,
  COMPLETED: ScanStatus.COMPLETED,
  FAILED: ScanStatus.REVIEW,
  PARTIAL: ScanStatus.REVIEW,
};

const prismaToSheetStatus: Record<ScanStatus, AnswerSheetStatus> = {
  [ScanStatus.PENDING]: "PENDING",
  [ScanStatus.SCANNED]: "SCANNED",
  [ScanStatus.PROCESSING]: "PROCESSING",
  [ScanStatus.GRADED]: "GRADED",
  [ScanStatus.REVIEW]: "REVIEW",
  [ScanStatus.COMPLETED]: "COMPLETED",
};

function mapSheetStatus(s: ScanStatus): AnswerSheetStatus {
  return prismaToSheetStatus[s] ?? "REVIEW";
}

export class PrismaScanningRepository implements ScanningRepository {
  async getScanBatch(institutionId: string, batchId: string): Promise<ScanBatch | null> {
    const row = await prisma.scanBatch.findFirst({
      where: { id: batchId, institutionId },
    });
    if (!row) return null;
    return {
      id: row.id,
      institutionId: row.institutionId,
      evaluationId: row.evaluationId,
      status:
        row.status === ScanStatus.PENDING
          ? "PENDING"
          : row.status === ScanStatus.PROCESSING
            ? "PROCESSING"
            : row.status === ScanStatus.COMPLETED
              ? "COMPLETED"
              : "PARTIAL",
      totalSheets: row.totalSheets,
      processedSheets: row.processedSheets,
    };
  }

  async getAnswerSheet(institutionId: string, sheetId: string): Promise<AnswerSheet | null> {
    // Hojas legacy: institutionId se valida via evaluation. Hojas de bundle:
    // institutionId se valida via bundle. Las hojas de bundle con evaluación
    // se procesan en Sprint 2 (aún no hay path de código activo).
    const row = await prisma.answerSheet.findFirst({
      where: {
        id: sheetId,
        OR: [{ evaluation: { institutionId } }, { bundle: { institutionId } }],
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      institutionId,
      evaluationId: row.evaluationId,
      bundleId: row.bundleId,
      studentId: row.studentId,
      studentName: row.studentName,
      studentCode: row.studentCode,
      qrContent: row.qrContent,
      qrSignature: row.qrSignature,
      scannedImage: row.scannedImage,
      status: mapSheetStatus(row.status),
      score: row.score,
      totalCorrect: row.totalCorrect,
      totalQuestions: row.totalQuestions,
    };
  }

  async updateSheetStatus(
    sheetId: string,
    status: AnswerSheetStatus,
    data?: { score?: number; totalCorrect?: number; totalQuestions?: number; notes?: string },
  ): Promise<void> {
    await prisma.answerSheet.update({
      where: { id: sheetId },
      data: {
        status: statusToPrisma[status],
        ...(data?.score !== undefined ? { score: data.score } : {}),
        ...(data?.totalCorrect !== undefined ? { totalCorrect: data.totalCorrect } : {}),
        ...(data?.totalQuestions !== undefined ? { totalQuestions: data.totalQuestions } : {}),
        ...(data?.notes ? { notes: data.notes } : {}),
      },
    });
  }

  async saveAnswers(sheetId: string, answers: StudentAnswerRecord[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.studentAnswer.deleteMany({ where: { answerSheetId: sheetId } });
      await tx.studentAnswer.createMany({
        data: answers.map((a) => ({
          answerSheetId: sheetId,
          questionId: a.questionId,
          // Sprint 4 del módulo compendios: bundleItemId poblado en hojas
          // de bundle, null en legacy. Habilita drill-down del reporte
          // comparativo por (student × item).
          bundleItemId: a.bundleItemId,
          selectedKey: a.selectedKey,
          isCorrect: a.isCorrect,
          isAmbiguous: a.isAmbiguous,
          confidence: a.confidence,
        })),
      });
    });
  }

  async updateBatchProgress(
    batchId: string,
    processed: number,
    status?: ScanBatchStatus,
  ): Promise<void> {
    await prisma.scanBatch.update({
      where: { id: batchId },
      data: {
        processedSheets: processed,
        ...(status ? { status: statusToPrisma[status] } : {}),
      },
    });
  }
}
