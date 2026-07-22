"use server";

import { revalidatePath } from "next/cache";
import { ScanStatus, Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { getOmrScanQueue } from "@/shared/infrastructure/queue/queues";
import { requireAuthenticatedUser } from "@/lib/session";

/** Encola un reprocess de una hoja individual. Borra respuestas previas,
 *  flagea PROCESSING con `processingStartedAt` para detectar bugs de
 *  doble-click en el botón Reprocesar, y mete el job en la cola
 *  `omr-scan`. El worker hace el resto.
 *
 *  Devuelve `ok: false` con `code: ALREADY_RUNNING` si la hoja ya está
 *  siendo procesada (carrera cliente doble-click o pestaña duplicada).
 */
export async function reprocessSheetAction(input: { sheetId: string; batchId: string }) {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const sheet = await prisma.answerSheet.findFirst({
    where: {
      id: input.sheetId,
      scanBatchId: input.batchId,
      OR: [
        {
          evaluation: {
            institutionId: actor.institutionId,
            teacherId: actor.userId,
            deletedAt: null,
          },
        },
        { bundle: { institutionId: actor.institutionId } },
      ],
    },
    select: {
      id: true,
      status: true,
      scanBatchId: true,
      scannedImage: true,
    },
  });
  if (!sheet) {
    return { ok: false as const, code: "NOT_FOUND" as const, error: "Hoja no encontrada." };
  }
  if (!sheet.scannedImage) {
    return {
      ok: false as const,
      code: "NO_IMAGE" as const,
      error: "La hoja no tiene imagen escaneada para reprocesar.",
    };
  }
  if (sheet.status === ScanStatus.PROCESSING) {
    return {
      ok: false as const,
      code: "ALREADY_RUNNING" as const,
      error: "La hoja ya está siendo procesada.",
    };
  }

  // Flip atómico a PROCESSING + limpia outputs previos en la misma tx.
  // Si dos requests entran concurrentes, el segundo verá status=PROCESSING
  // gracias al where clause y caerá por ALREADY_RUNNING.
  const updated = await prisma.answerSheet.updateMany({
    where: { id: sheet.id, status: { not: ScanStatus.PROCESSING } },
    data: {
      status: ScanStatus.PROCESSING,
      // Limpiamos score/correctas/notas/diagnóstico del run anterior —
      // el worker los repuebla. processedImage queda: la UI puede
      // mostrar el overlay antiguo mientras el nuevo se genera, y el
      // worker lo sobreescribe si todo va bien.
      score: null,
      totalCorrect: null,
      totalQuestions: null,
      notes: null,
      gridLayout: Prisma.JsonNull,
      detectionConfidence: null,
    },
  });
  if (updated.count === 0) {
    // Otro request ganó la carrera entre el findFirst y el update.
    return {
      ok: false as const,
      code: "ALREADY_RUNNING" as const,
      error: "La hoja ya está siendo procesada.",
    };
  }

  // best-effort delete de respuestas previas — si falla, el worker las
  // sobreescribe igual con `deleteMany` al guardar (Sprint 4 persistencia).
  // Lo dejamos afuera del tx principal para no bloquear la cola.
  await prisma.studentAnswer.deleteMany({ where: { answerSheetId: sheet.id } }).catch(() => {
    /* ignore */
  });

  try {
    const queue = getOmrScanQueue();
    await queue.add(
      "omr-scan",
      {
        answerSheetId: sheet.id,
        scanBatchId: sheet.scanBatchId ?? "",
        institutionId: actor.institutionId,
        // Chequeado por null arriba; TS no propagó el narrowing en
        // updateMany porque no está en la misma cláusula.
        imagePath: sheet.scannedImage!,
      },
      // OJO: `jobId` NO puede llevar ":" — BullMQ lo rechaza salvo que haya
      // exactamente 3 segmentos (compat con repeatable jobs viejos), y su
      // propio TODO dice que esa excepción desaparece en el próximo
      // breaking change. Usamos "__" para no depender de esa casualidad.
      { attempts: 1, jobId: `reprocess__${sheet.id}__${Date.now()}` },
    );
  } catch (e) {
    // Si la cola no está accesible (Redis caído), devolvemos la hoja a
    // SCANNED para que el operador la pueda reintentar manualmente desde
    // el listado en lugar de quedar atascada en PROCESSING.
    await prisma.answerSheet.update({
      where: { id: sheet.id },
      data: { status: ScanStatus.SCANNED, notes: "Fallo al encolar reproceso." },
    });
    return {
      ok: false as const,
      code: "ENQUEUE_FAILED" as const,
      error: "No se pudo encolar el reproceso (revisa Redis).",
    };
  }

  revalidatePath(`/teacher/scan/${input.batchId}/${input.sheetId}`);
  revalidatePath(`/teacher/scan`);
  return { ok: true as const };
}
