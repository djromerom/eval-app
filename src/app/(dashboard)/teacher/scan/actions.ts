"use server";

import { revalidatePath } from "next/cache";
import { nombreDeArchivo } from "@/modules/scanning/domain/scan-filename";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { getOmrScanQueue } from "@/shared/infrastructure/queue/queues";
import { requireAuthenticatedUser } from "@/lib/session";

/** Tipo discriminado del "objetivo" del escaneo: o una formulación
 *  individual (legacy) o un cuadernillo. La invariante XOR vive aquí. */
export type ScanTargetKind = "evaluation" | "bundle";

export async function createScanBatchAction(formData: FormData) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  const kind = formData.get("kind") as ScanTargetKind | null;
  const targetId = formData.get("id") as string | null;
  const files = formData.getAll("files") as File[];

  if (!kind || !targetId || files.length === 0) {
    return {
      ok: false as const,
      error: "Selecciona un objetivo (formulación o cuadernillo) y al menos un archivo.",
    };
  }

  if (kind === "evaluation") {
    return createEvaluationScanBatch(actor, targetId, files);
  }
  if (kind === "bundle") {
    return createBundleScanBatch(actor, targetId, files);
  }
  return { ok: false as const, error: `Tipo de objetivo no soportado: ${kind}` };
}

async function createEvaluationScanBatch(
  actor: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  evaluationId: string,
  files: File[],
) {
  if (files.length > 200) {
    return { ok: false as const, error: "Máximo 200 hojas por lote." };
  }

  const evaluation = await prisma.evaluation.findFirst({
    where: {
      id: evaluationId,
      institutionId: actor.institutionId,
      teacherId: actor.userId,
      deletedAt: null,
    },
  });
  if (!evaluation) {
    return { ok: false as const, error: "Formulación no encontrada." };
  }

  const batch = await prisma.scanBatch.create({
    data: {
      institutionId: actor.institutionId,
      evaluationId,
      bundleId: null,
      uploadedBy: actor.userId,
      status: "PENDING",
      totalSheets: files.length,
      processedSheets: 0,
    },
  });

  await enqueueSheets(actor, batch.id, files, "evaluation", evaluationId);
  revalidatePath("/teacher/scan");
  return { ok: true as const, batchId: batch.id };
}

async function createBundleScanBatch(
  actor: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  bundleId: string,
  files: File[],
) {
  if (files.length > 200) {
    return { ok: false as const, error: "Máximo 200 hojas por lote." };
  }

  const bundle = await prisma.evaluationBundle.findFirst({
    where: {
      id: bundleId,
      institutionId: actor.institutionId,
    },
    select: { id: true, status: true, name: true },
  });
  if (!bundle) {
    return { ok: false as const, error: "Cuadernillo no encontrado." };
  }
  // Solo cuadernillos READY tienen clave unificada generada y admiten
  // calificación. Mismo chequeo que el reportador comparativo.
  if (bundle.status !== "READY") {
    return {
      ok: false as const,
      error: `El cuadernillo debe estar en estado LISTO para escanear (actual: ${bundle.status}).`,
    };
  }

  const batch = await prisma.scanBatch.create({
    data: {
      institutionId: actor.institutionId,
      evaluationId: null,
      bundleId,
      uploadedBy: actor.userId,
      status: "PENDING",
      totalSheets: files.length,
      processedSheets: 0,
    },
  });

  await enqueueSheets(actor, batch.id, files, "bundle", bundleId);
  revalidatePath("/teacher/scan");
  return { ok: true as const, batchId: batch.id };
}

/** Crea AnswerSheet + encola job omr-scan. `targetKind` discrimina si la
 *  hoja es de formulación o bundle, y `targetId` se guarda en AnswerSheet
 *  para que el reporte comparativo del cuadernillo pueda drill-dowmear
 *  (student/hoja × item). */


async function enqueueSheets(
  actor: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  batchId: string,
  files: File[],
  targetKind: ScanTargetKind,
  targetId: string,
) {
  const queue = getOmrScanQueue();
  const batchDir = `scans/${batchId}`;

  // Nombres ya usados en este lote. El timestamp solo da unicidad si dos
  // archivos no caen en el mismo milisegundo, y un lote se sube en rafaga: sin
  // esto dos hojas podrian pisarse en silencio, que es exactamente el modo de
  // falla que ya nos costo un lote entero de artefactos.
  const usados = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const bytes = Buffer.from(await file.arrayBuffer());
    const relativePath = `${batchDir}/${nombreDeArchivo(file.name, i, usados)}`;
    await localStorage.save(relativePath, bytes);

    const sheet = await prisma.answerSheet.create({
      data: {
        evaluationId: targetKind === "evaluation" ? targetId : null,
        bundleId: targetKind === "bundle" ? targetId : null,
        studentId: null,
        qrContent: "",
        qrSignature: "",
        scannedImage: relativePath,
        // El archivo se guarda renombrado a sheet_NNN.ext, asi que sin esto el
        // nombre que salio del escaner se perderia y no habria forma de
        // rastrear una hoja hasta su origen. `file.name` puede venir vacio si
        // el cliente sube un Blob sin nombre: en ese caso se deja null.
        originalFilename: file.name || null,
        scanBatchId: batchId,
        status: "PENDING",
      },
    });

    await queue.add("omr-scan", {
      answerSheetId: sheet.id,
      scanBatchId: batchId,
      institutionId: actor.institutionId,
      imagePath: relativePath,
    });
  }
}

export interface BatchWithSheets {
  id: string;
  /** "evaluation" si el batch es de una formulación, "bundle" si es de un
   *  cuadernillo, "unknown" si la FK quedó null por datos legacy. */
  kind: ScanTargetKind | "unknown";
  status: string;
  totalSheets: number;
  processedSheets: number;
  createdAt: Date;
  /** Nombre del objetivo (formulación o cuadernillo). null si no se pudo
   *  resolver (huérfanos o datos legacy). */
  title: string | null;
  sheets: {
    id: string;
    status: string;
    studentName: string | null;
    studentCode: string | null;
    score: number | null;
    totalCorrect: number | null;
    totalQuestions: number | null;
    reviewedBy: string | null;
    notes: string | null;
  }[];
}

export async function getBatchesAction(): Promise<BatchWithSheets[]> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  // Filtro multi-target: el batch pertenece a la institución y:
  //   - es de una formulación del docente actual, o
  //   - es de un cuadernillo de la institución (cualquier docente del
  //     colegio puede escanear, los cuadernillos son institucionales).
  const rows = await prisma.scanBatch.findMany({
    where: {
      institutionId: actor.institutionId,
      OR: [
        { evaluation: { teacherId: actor.userId, deletedAt: null } },
        { bundle: { institutionId: actor.institutionId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      evaluation: { select: { title: true } },
      bundle: { select: { name: true } },
      sheets: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          studentName: true,
          studentCode: true,
          score: true,
          totalCorrect: true,
          totalQuestions: true,
          reviewedBy: true,
          notes: true,
        },
      },
    },
  });

  return rows.map((b) => {
    const kind: ScanTargetKind | "unknown" = b.evaluationId
      ? "evaluation"
      : b.bundleId
        ? "bundle"
        : "unknown";
    const title = b.evaluation?.title ?? b.bundle?.name ?? null;

    return {
      id: b.id,
      kind,
      title,
      status: b.status,
      totalSheets: b.totalSheets,
      processedSheets: b.processedSheets,
      createdAt: b.createdAt,
      sheets: b.sheets.map((s) => ({
        id: s.id,
        status: s.status,
        studentName: s.studentName,
        studentCode: s.studentCode,
        score: s.score,
        totalCorrect: s.totalCorrect,
        totalQuestions: s.totalQuestions,
        reviewedBy: s.reviewedBy,
        notes: s.notes,
      })),
    };
  });
}
