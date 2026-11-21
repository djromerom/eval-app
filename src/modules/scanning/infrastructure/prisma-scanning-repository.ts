import { ScanStatus, Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import type {
  AnswerSheet,
  AnswerSheetStatus,
  DuplicateSheetInfo,
  GridLayoutRecord,
  ScanBatch,
  ScanBatchStatus,
  ScanningRepository,
  StudentAnswerRecord,
  StudentAnswersReader,
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
      scanBatchId: row.scanBatchId,
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

  /** Ficha de la otra hoja que ya tiene este id de papel. La aplicación la
   *  usa para decidir cuál se queda cuando el mismo papel entra dos veces
   *  (mismo lote → la que tiene respuestas; otro lote → la nueva pisa a la
   *  vieja). */
  async findDuplicateSheet(
    qrSheetUuid: string,
    exceptoSheetId: string,
  ): Promise<DuplicateSheetInfo | null> {
    const otra = await prisma.answerSheet.findFirst({
      where: { qrSheetUuid, id: { not: exceptoSheetId } },
      select: {
        id: true,
        scanBatchId: true,
        status: true,
        score: true,
        totalCorrect: true,
        _count: { select: { answers: true } },
      },
    });
    if (!otra) return null;
    return {
      id: otra.id,
      scanBatchId: otra.scanBatchId,
      status: mapSheetStatus(otra.status),
      score: otra.score,
      totalCorrect: otra.totalCorrect,
      tieneRespuestas: otra._count.answers > 0 || otra.score !== null,
    };
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

  /** Ver documentación completa en el interface `ScanningRepository`.
   *  Borramos archivos físicos ANTES del tx (best-effort): si el archivo
   *  ya no está en disco, `localStorage.delete` lo loggea y sigue — no
   *  queremos que un archivo huérfano impida una eliminación legítima.
   *  El tx hace:
   *    - DELETE AnswerSheet (cascade borra StudentAnswer por `onDelete`).
   *    - Decrementa `ScanBatch.totalSheets`.
   *  `processedSheets` queda intacto: su valor actual no refleja la
   *  realidad (`updateBatchProgress` lo escribe a 0 en cada fallo del
   *  worker — bug preexistente); decrementarlo acá mezclaría dos temas.
   *  Total lo ve el docente como "X/200" en el encabezado del lote.
   *  Devuelve `{batchId: null}` si la hoja no existe (caller mapea a
   *  NOT_FOUND). Si existe pero está PROCESSING, lanza — defensa final:
   *  el worker está escribiendo sobre esa fila y borrarla en mitad del
   *  procesamiento deja respuestas huérfanas. Cualquier otro estado se
   *  borra: el docente necesita quitar una hoja mal escaneada o que ya
   *  estaba reprocesada. */
  async deleteSheet(
    sheetId: string,
    opciones?: { conservarArchivos?: boolean; forzar?: boolean },
  ): Promise<{ batchId: string | null }> {
    console.log("[Prisma.deleteSheet] start", sheetId);
    const row = await prisma.answerSheet.findUnique({
      where: { id: sheetId },
      select: {
        id: true,
        status: true,
        scannedImage: true,
        processedImage: true,
        scanBatchId: true,
      },
    });
    if (!row) {
      console.log("[Prisma.deleteSheet] sheet no encontrada");
      return { batchId: null };
    }
    console.log("[Prisma.deleteSheet] row", { status: row.status, scanBatchId: row.scanBatchId });

    if (row.status === ScanStatus.PROCESSING && !opciones?.forzar) {
      throw new Error(
        `deleteSheet rechazó la hoja ${sheetId}: status=${row.status} (el worker la está procesando).`,
      );
    }

    // Best-effort: ENOENT ya está manejado dentro de localStorage.delete.
    // `conservarArchivos` deja los archivos: el papel se está reescaneando y
    // su imagen pasa a la hoja que queda.
    if (!opciones?.conservarArchivos) {
      if (row.scannedImage) await localStorage.delete(row.scannedImage);
      if (row.processedImage) await localStorage.delete(row.processedImage);
    }

    const batchId = row.scanBatchId;

    await prisma.$transaction(async (tx) => {
      await tx.answerSheet.delete({ where: { id: sheetId } });
      if (batchId) {
        await tx.scanBatch.update({
          where: { id: batchId },
          data: { totalSheets: { decrement: 1 } },
        });
      }
    });
    console.log("[Prisma.deleteSheet] borrada OK");

    return { batchId };
  }

  /** Ver documentación completa en el interface. No autoriza: trae los
   *  campos necesarios para que el use case haga el OR de validación
   *  (mismo filtro que getBatchesAction:254). Si el batch no existe,
   *  devuelve `null` — el caller mapea a NOT_FOUND. */
  async findBatchAccess(batchId: string) {
    return prisma.scanBatch.findUnique({
      where: { id: batchId },
      select: {
        institutionId: true,
        uploadedBy: true,
        evaluation: { select: { teacherId: true } },
        bundle: { select: { institutionId: true } },
      },
    });
  }

  /** Ver documentación completa en el interface `ScanningRepository`.
   *
   *  Logs TEMP DEBUG: el MEMORY rule "Mantener console.log TEMP DEBUG en
   *  eval-app" indica dejarlos como instrumentación pasiva. Útiles para
   *  auditar un "¿quién borró este lote?" en logs de prod. */
  async deleteBatch(batchId: string): Promise<{ institutionId: string | null }> {
    console.log("[Prisma.deleteBatch] start", batchId);
    const batch = await prisma.scanBatch.findUnique({
      where: { id: batchId },
      select: {
        institutionId: true,
        sheets: { select: { scannedImage: true, processedImage: true } },
        unclassifiedScans: { select: { filePath: true } },
      },
    });
    if (!batch) {
      console.log("[Prisma.deleteBatch] batch no encontrado");
      return { institutionId: null };
    }

    // 1) Unlink best-effort antes del tx — coherente con deleteSheet:302-305.
    //    Si un archivo ya no existe en disco, `localStorage.delete` loggea y
    //    sigue; NO queremos que un huérfano impida el borrado legítimo.
    for (const s of batch.sheets) {
      if (s.scannedImage) await localStorage.delete(s.scannedImage);
      if (s.processedImage) await localStorage.delete(s.processedImage);
    }
    for (const u of batch.unclassifiedScans) {
      if (u.filePath) await localStorage.delete(u.filePath);
    }

    // 2) Tx con el orden deleteMany → delete. RESTRICT en
    //    AnswerSheet.scanBatch (schema:884-885) lo exige: invertirlo tira
    //    P2003. StudentAnswer (cascade) y UnclassifiedScan (cascade desde
    //    ScanBatch) se van solos.
    await prisma.$transaction(async (tx) => {
      await tx.answerSheet.deleteMany({ where: { scanBatchId: batchId } });
      await tx.scanBatch.delete({ where: { id: batchId } });
    });

    console.log("[Prisma.deleteBatch] borrado OK", {
      sheets: batch.sheets.length,
      unclassifiedScans: batch.unclassifiedScans.length,
    });
    return { institutionId: batch.institutionId };
  }

  /** Ver documentación completa en el interface. El modelo `AuditLog`
   *  (`schema.prisma:979`) es compartido con otras acciones del sistema
   *  (`EVALUATION_CREATED`, etc.); reutilizamos para mantener un log
   *  unificado por institución. `entityShortId` es legible para humanos
   *  y `entityId` permite drill-down posterior desde la UI de admin.
   *
   *  Esta impl NO maneja errores — el use case lo envuelve en try/catch
   *  porque el log es secundario al evento de borrado. */
  async recordDeletionAudit(input: {
    actorUserId: string;
    actorRoles: readonly string[];
    action: "SHEET_DELETED" | "BATCH_DELETED";
    entityType: "AnswerSheet" | "ScanBatch";
    entityId: string;
    entityShortId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: {
          actorRoles: input.actorRoles as unknown as Prisma.InputJsonValue,
          entityShortId: input.entityShortId,
          ...(input.metadata ?? {}),
        } as Prisma.InputJsonValue,
      },
    });
  }
}

/** Lector de StudentAnswer para el use case de correcciones manuales.
 *  Implementado aparte de `PrismaScanningRepository` para no inflar su
 *  superficie ni obligar a los tests del worker a mockear un método que
 *  no usan. */
export class PrismaStudentAnswersReader implements StudentAnswersReader {
  async listStudentAnswersForSheet(sheetId: string): Promise<StudentAnswerRecord[]> {
    const rows = await prisma.studentAnswer.findMany({
      where: { answerSheetId: sheetId },
      orderBy: { id: "asc" },
      select: {
        questionId: true,
        bundleItemId: true,
        selectedKey: true,
        isCorrect: true,
        isAmbiguous: true,
        confidence: true,
        cells: true,
        fillRatio: true,
      },
    });
    return rows.map((r) => ({
      questionId: r.questionId,
      bundleItemId: r.bundleItemId,
      // StudentAnswer.selectedKey es `String?` en Prisma; el dominio lo espera
      // `AnswerKey | null`. Hacemos el cast explícito porque la columna ya está
      // validada contra el dominio en el momento de escritura (worker y este
      // mismo use case). Si llegara un valor fuera del rango A-H sería un
      // bug de otro path — preferimos propagarlo como null antes que cortar
      // la corrección manual entera.
      selectedKey: (r.selectedKey ?? null) as StudentAnswerRecord["selectedKey"],
      isCorrect: r.isCorrect,
      isAmbiguous: r.isAmbiguous,
      confidence: r.confidence,
      cells: (r.cells as unknown as StudentAnswerRecord["cells"]) ?? undefined,
      fillRatio: r.fillRatio,
    }));
  }
}
