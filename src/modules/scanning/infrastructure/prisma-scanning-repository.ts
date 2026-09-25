import { ScanStatus, Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  AnswerSheet,
  AnswerSheetStatus,
  GridLayoutRecord,
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
      bundleId: row.bundleId,
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
    // institutionId se valida via bundle. Las hojas de bundle con formulación
    // se procesan en Sprint 2 (aún no hay path de código activo).
    const row = await prisma.answerSheet.findFirst({
      where: {
        id: sheetId,
        OR: [{ evaluation: { institutionId } }, { bundle: { institutionId } }],
      },
      include: { unclassifiedScan: { select: { id: true } } },
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
      identificadaAMano: row.unclassifiedScan != null,
    };
  }

  async updateSheetStatus(
    sheetId: string,
    status: AnswerSheetStatus,
    data?: {
      score?: number;
      totalCorrect?: number;
      totalQuestions?: number;
      notes?: string;
      gridLayout?: GridLayoutRecord;
      detectionConfidence?: number;
      processedImage?: string;
    },
  ): Promise<void> {
    await prisma.answerSheet.update({
      where: { id: sheetId },
      data: {
        status: statusToPrisma[status],
        ...(data?.score !== undefined ? { score: data.score } : {}),
        ...(data?.totalCorrect !== undefined ? { totalCorrect: data.totalCorrect } : {}),
        ...(data?.totalQuestions !== undefined ? { totalQuestions: data.totalQuestions } : {}),
        ...(data?.notes ? { notes: data.notes } : {}),
        // Sprint 9 OMR auto-detect: persistimos la geometría detectada y la
        // ruta al overlay PNG para que la UI matriz no tenga que re-detectar.
        // Prisma recibe `Json?` como `Prisma.InputJsonValue`.
        ...(data?.gridLayout !== undefined
          ? { gridLayout: data.gridLayout as unknown as Prisma.InputJsonValue }
          : {}),
        ...(data?.detectionConfidence !== undefined
          ? { detectionConfidence: data.detectionConfidence }
          : {}),
        ...(data?.processedImage ? { processedImage: data.processedImage } : {}),
      },
    });
  }

  async findSheetIdByQrSheetUuid(
    qrSheetUuid: string,
    exceptoSheetId: string,
  ): Promise<string | null> {
    const otra = await prisma.answerSheet.findFirst({
      where: { qrSheetUuid, id: { not: exceptoSheetId } },
      select: { id: true },
    });
    return otra?.id ?? null;
  }

  async saveDecodedQr(
    sheetId: string,
    qrContent: string,
    qrSignature: string,
    studentCode: string | null,
    qrSheetUuid?: string | null,
  ): Promise<{ studentId: string | null; duplicada: boolean }> {
    // Buscar el estudiante por código (incluyendo histórico de códigos viejos).
    let studentId: string | null = null;
    if (studentCode) {
      const sheet = await prisma.answerSheet.findFirst({
        where: { id: sheetId },
        select: {
          evaluation: { select: { institutionId: true } },
          bundle: { select: { institutionId: true } },
        },
      });
      const institutionId = sheet?.evaluation?.institutionId ?? sheet?.bundle?.institutionId;
      if (institutionId) {
        const direct = await prisma.student.findFirst({
          where: { institutionId, code: studentCode, deletedAt: null },
          select: { id: true },
        });
        if (direct) {
          studentId = direct.id;
        } else {
          // El QR viejo debe seguir funcionando: busca en el historial de códigos.
          const history = await prisma.studentCodeHistory.findFirst({
            where: { oldCode: studentCode, student: { institutionId, deletedAt: null } },
            select: { studentId: true },
            orderBy: { changedAt: "desc" },
          });
          if (history) studentId = history.studentId;
        }
      }
    }

    // El indice unico es la red contra la carrera entre workers: dos hojas
    // duplicadas procesandose a la vez pasan ambas el chequeo previo, pero
    // solo una puede escribir el uuid. La otra cae acá y se reporta duplicada
    // en vez de reventar el job.
    try {
      await prisma.answerSheet.update({
        where: { id: sheetId },
        data: { qrSheetUuid: qrSheetUuid ?? null },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && qrSheetUuid) {
        return { studentId: null, duplicada: true };
      }
      throw e;
    }

    await prisma.answerSheet.update({
      where: { id: sheetId },
      data: {
        qrContent,
        qrSignature,
        ...(studentId ? { studentId } : {}),
      },
    });

    // Codigo del QR como respaldo legible. Antes esto era
    // `...(studentCode ? {} : {})` dentro del update de arriba, que extiende
    // {} en las dos ramas y no escribia nada: 22 de 22 hojas identificadas
    // tenian studentCode en NULL pese a traerlo el QR.
    //
    // Va como updateMany con `studentCode: null` en el where para no pisar un
    // codigo escrito a mano: si la hoja ya lo trae, ese gana. Expresar la
    // condicion en el where lo hace atomico, en vez de leer-y-decidir.
    if (studentCode) {
      await prisma.answerSheet.updateMany({
        where: { id: sheetId, studentCode: null },
        data: { studentCode },
      });
    }

    return { studentId, duplicada: false };
  }

  async saveAnswers(sheetId: string, answers: StudentAnswerRecord[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.studentAnswer.deleteMany({ where: { answerSheetId: sheetId } });
      await tx.studentAnswer.createMany({
        data: answers.map((a) => ({
          answerSheetId: sheetId,
          questionId: a.questionId,
          // Sprint 4 del módulo cuadernillos: bundleItemId poblado en hojas
          // de bundle, null en legacy. Habilita drill-down del reporte
          // comparativo por (student × item).
          bundleItemId: a.bundleItemId,
          selectedKey: a.selectedKey,
          isCorrect: a.isCorrect,
          isAmbiguous: a.isAmbiguous,
          confidence: a.confidence,
          // Sprint 9 OMR auto-detect: diagnóstico per-bubble para la UI
          // matriz y fill ratio de la burbuja seleccionada (atajo).
          cells: (a.cells ?? undefined) as Prisma.InputJsonValue | undefined,
          fillRatio: a.fillRatio ?? null,
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
