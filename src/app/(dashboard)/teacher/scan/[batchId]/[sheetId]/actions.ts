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
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

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

/**
 * Marca una hoja como revisada por un humano: `REVIEW` -> `COMPLETED`.
 *
 * El worker deja en `REVIEW` cualquier hoja con al menos una marca ambigua
 * (`process-answer-sheet.ts`: `answers.some(a => a.isAmbiguous) ? "REVIEW" :
 * "GRADED"`). Hasta ahora no habia forma de salir de ese estado: reprocesar
 * corre el mismo motor sobre la misma imagen y devuelve lo mismo, asi que una
 * hoja revisada a mano figuraba "con observaciones" para siempre. El enum ya
 * tenia `COMPLETED` declarado, pero nadie lo escribia.
 *
 * Dos guardas deliberadas:
 *   - Solo desde `REVIEW`. Marcar una hoja que nunca fue observada no
 *     significa nada, y desde `PENDING` o `PROCESSING` ocultaria trabajo sin
 *     terminar.
 *   - Solo con puntaje. Confirmar una hoja sin calificar la sacaria de la
 *     lista de pendientes sin que exista una nota que confirmar.
 *
 * La condicion viaja en el `where` del updateMany: si dos revisores le dan al
 * boton a la vez, el segundo no encuentra fila y se entera, en vez de pisar.
 */
export async function marcarRevisadaAction(input: { sheetId: string; batchId: string }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

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
    select: { id: true, status: true, score: true, studentId: true },
  });
  if (!sheet) {
    return { ok: false as const, error: "Hoja no encontrada." };
  }
  // Una hoja con QR ilegible ya llega calificada pero sin estudiante: no se
  // puede dar por revisada una nota que no es de nadie.
  if (!sheet.studentId) {
    return {
      ok: false as const,
      error: "Asigna el estudiante antes de marcar la hoja como revisada.",
    };
  }
  if (sheet.status !== ScanStatus.REVIEW) {
    return {
      ok: false as const,
      error: `Solo se puede confirmar una hoja en revisión (estado actual: ${sheet.status}).`,
    };
  }
  if (sheet.score === null) {
    return {
      ok: false as const,
      error: "La hoja todavía no tiene puntaje: no hay calificación que confirmar.",
    };
  }

  const { count } = await prisma.answerSheet.updateMany({
    where: { id: sheet.id, status: ScanStatus.REVIEW },
    data: {
      status: ScanStatus.COMPLETED,
      reviewedBy: actor.userId,
      reviewedAt: new Date(),
    },
  });
  if (count === 0) {
    return { ok: false as const, error: "Otra persona ya revisó esta hoja." };
  }

  revalidatePath(`/teacher/scan/${input.batchId}/${input.sheetId}`);
  revalidatePath(`/teacher/scan/${input.batchId}`);
  revalidatePath("/teacher/scan");
  return { ok: true as const };
}

/** Asocia manualmente una hoja huérfana (QR no detectado) a un estudiante.
 *  Se usa desde el detalle de la hoja cuando el worker escribió algo como
 *  "QR could not be decoded" en `notes` y la hoja quedó sin `studentId`.
 *
 *  Validaciones, todas adentro del bloque try para distinguir 404 (hoja ya
 *  no existe) de 403/400:
 *    - tenant + lote del docente o de la institución
 *    - la hoja NO tiene estudiante todavía (no pisa una asociación buena)
 *    - el lote viene de un Cuadernillo (los formularios sueltos no ofrecen
 *      este flujo — la página no monta el botón en ese caso)
 *    - el estudiante pertenece a la misma institución
 *    - el estudiante está en un curso que el cuadernillo cubre (sus
 *      `bundleItem.evaluation.courseSubject.courseId` ∈ cursos del bundle)
 *
 *  Solo escribe `studentId`. NO toca `studentName`/`studentCode`: esos siguen
 *  siendo respaldo legible del QR o del handwriting; el nombre se reconstruye
 *  desde `Student` cuando hace falta.
 *
 *  Devuelve ok=true si asoció, ok=false con código estable en cualquier otro
 *  caso (la página muestra el `error`).
 */
export async function asignarEstudianteHojaAction(input: {
  sheetId: string;
  batchId: string;
  studentId: string;
}) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");

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
      studentId: true,
      bundle: { select: { id: true } },
    },
  });
  if (!sheet) {
    return { ok: false as const, code: "NOT_FOUND" as const, error: "Hoja no encontrada." };
  }
  if (sheet.studentId) {
    return {
      ok: false as const,
      code: "ALREADY_ASSIGNED" as const,
      error: "Esta hoja ya tiene un estudiante asociado.",
    };
  }
  if (!sheet.bundle) {
    return {
      ok: false as const,
      code: "NOT_A_BUNDLE" as const,
      error: "Solo se puede asignar manualmente en hojas de un Cuadernillo.",
    };
  }

  // Cursos del cuadernillo = unión de courseId de cada bundleItem.evaluation.
  const items = await prisma.evaluationBundleItem.findMany({
    where: { bundleId: sheet.bundle.id },
    select: {
      evaluation: {
        select: { courseSubject: { select: { courseId: true } } },
      },
    },
  });
  const courseIds = [...new Set(items.map((i) => i.evaluation.courseSubject.courseId))];
  if (courseIds.length === 0) {
    return {
      ok: false as const,
      code: "EMPTY_BUNDLE" as const,
      error: "El cuadernillo no tiene formulaciones; no se puede inferir el curso.",
    };
  }

  const student = await prisma.student.findFirst({
    where: {
      id: input.studentId,
      institutionId: actor.institutionId,
      isActive: true,
      group: { courseId: { in: courseIds } },
    },
    select: { id: true },
  });
  if (!student) {
    return {
      ok: false as const,
      code: "STUDENT_NOT_IN_COURSE" as const,
      error: "El estudiante no pertenece a un curso cubierto por este cuadernillo.",
    };
  }

  // Sin QR no hay id de papel con qué detectar un papel ya calificado. Si el
  // estudiante ya tiene otra hoja CALIFICADA de este cuadernillo, asignarle
  // esta crearía una segunda nota, y como los reportes toman la hoja más
  // reciente, taparía la buena. Se bloquea y se enlaza la otra hoja.
  const otra = await prisma.answerSheet.findFirst({
    where: {
      id: { not: sheet.id },
      bundleId: sheet.bundle.id,
      studentId: student.id,
      score: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, scanBatchId: true },
  });
  if (otra) {
    return {
      ok: false as const,
      code: "DUPLICATE_STUDENT" as const,
      error: "Este estudiante ya tiene una hoja calificada de este cuadernillo.",
      otraHoja: otra.scanBatchId ? { id: otra.id, batchId: otra.scanBatchId } : null,
    };
  }

  await prisma.answerSheet.update({
    where: { id: sheet.id },
    data: { studentId: student.id },
  });

  revalidatePath(`/teacher/scan/${input.batchId}/${input.sheetId}`);
  revalidatePath(`/teacher/scan/${input.batchId}`);
  return { ok: true as const };
}
