import { ScanStatus } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { getOmrScanQueue } from "@/shared/infrastructure/queue/queues";
import {
  elegirLoteDestino,
  type CuadernilloParaClasificar,
  type HojaSinClasificar,
  type OmrJobQueue,
  type UnclassifiedScanRepository,
} from "../domain/unclassified-scan";

export class PrismaUnclassifiedScanRepository implements UnclassifiedScanRepository {
  async findById(institutionId: string, id: string): Promise<HojaSinClasificar | null> {
    return prisma.unclassifiedScan.findFirst({
      where: { id, institutionId },
      select: {
        id: true,
        institutionId: true,
        scanBatchId: true,
        filePath: true,
        originalFilename: true,
        reason: true,
        resolvedAt: true,
      },
    });
  }

  async findBundle(
    institutionId: string,
    bundleId: string,
  ): Promise<CuadernilloParaClasificar | null> {
    const b = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: {
        id: true,
        status: true,
        items: {
          select: { evaluation: { select: { courseSubject: { select: { courseId: true } } } } },
        },
      },
    });
    if (!b) return null;
    return {
      id: b.id,
      status: b.status,
      courseIds: [...new Set(b.items.map((i) => i.evaluation.courseSubject.courseId))],
    };
  }

  async studentInCourses(
    institutionId: string,
    studentId: string,
    courseIds: string[],
  ): Promise<boolean> {
    const s = await prisma.student.findFirst({
      where: {
        id: studentId,
        institutionId,
        isActive: true,
        deletedAt: null,
        group: { courseId: { in: courseIds } },
      },
      select: { id: true },
    });
    return s != null;
  }

  async findGradedSheetOf(bundleId: string, studentId: string) {
    return prisma.answerSheet.findFirst({
      where: { bundleId, studentId, score: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, scanBatchId: true },
    });
  }

  async resolverEnHoja(args: {
    hoja: HojaSinClasificar;
    bundleId: string;
    studentId: string;
    resolvedBy: string;
  }): Promise<{ sheetId: string; batchId: string } | "ALREADY_RESOLVED"> {
    const { hoja, bundleId, studentId, resolvedBy } = args;
    return prisma.$transaction(async (tx) => {
      // Reclamo atómico: si dos personas (o un doble clic) clasifican la misma
      // hoja, la segunda espera el bloqueo de la fila y ya la ve resuelta.
      const reclamo = await tx.unclassifiedScan.updateMany({
        where: { id: hoja.id, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedBy },
      });
      if (reclamo.count === 0) return "ALREADY_RESOLVED" as const;

      const origen = await tx.scanBatch.findUniqueOrThrow({
        where: { id: hoja.scanBatchId },
        select: { id: true, bundleId: true, uploadedBy: true, createdAt: true },
      });
      const candidatos =
        origen.bundleId === bundleId
          ? []
          : await tx.scanBatch.findMany({
              where: {
                institutionId: hoja.institutionId,
                bundleId,
                uploadedBy: origen.uploadedBy,
                createdAt: { gte: origen.createdAt },
              },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: 1,
              select: { id: true, bundleId: true, uploadedBy: true, createdAt: true },
            });

      let batchId = elegirLoteDestino(origen, bundleId, candidatos);
      if (batchId) {
        await tx.scanBatch.update({
          where: { id: batchId },
          data: { totalSheets: { increment: 1 } },
        });
      } else {
        // Lo sube "la misma persona" que subió la carga: las imágenes vienen
        // de ahí, y así el lote aparece en su lista de lotes recientes.
        const nuevo = await tx.scanBatch.create({
          data: {
            institutionId: hoja.institutionId,
            evaluationId: null,
            bundleId,
            uploadedBy: origen.uploadedBy,
            status: "PENDING",
            totalSheets: 1,
            processedSheets: 0,
          },
          select: { id: true },
        });
        batchId = nuevo.id;
      }

      const sheet = await tx.answerSheet.create({
        data: {
          evaluationId: null,
          bundleId,
          studentId,
          qrContent: "",
          qrSignature: "",
          // El archivo se queda en sin-clasificar/: el worker y la descarga
          // aceptan cualquier ruta relativa de storage.
          scannedImage: hoja.filePath,
          originalFilename: hoja.originalFilename,
          scanBatchId: batchId,
          status: "PENDING",
        },
        select: { id: true },
      });
      await tx.unclassifiedScan.update({
        where: { id: hoja.id },
        data: { answerSheetId: sheet.id },
      });
      return { sheetId: sheet.id, batchId };
    });
  }

  async marcarNoEncolada(sheetId: string): Promise<void> {
    // Mismo estado y nota que usa Reprocesar cuando la cola no responde.
    await prisma.answerSheet.update({
      where: { id: sheetId },
      data: { status: ScanStatus.SCANNED, notes: "Fallo al encolar reproceso." },
    });
  }
}

export const bullOmrJobQueue: OmrJobQueue = {
  async enqueue(job) {
    await getOmrScanQueue().add("omr-scan", job);
  },
};
