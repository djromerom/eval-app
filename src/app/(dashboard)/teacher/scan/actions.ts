"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { getOmrScanQueue } from "@/shared/infrastructure/queue/queues";
import { requireAuthenticatedUser } from "@/lib/session";

/** Tipo discriminado del "objetivo" del escaneo: o una evaluación
 *  individual (legacy) o un compendio. La invariante XOR vive aquí. */
export type ScanTargetKind = "evaluation" | "bundle";

export async function createScanBatchAction(formData: FormData) {
  const actor = await requireAuthenticatedUser("TEACHER");

  const kind = formData.get("kind") as ScanTargetKind | null;
  const targetId = formData.get("id") as string | null;
  const files = formData.getAll("files") as File[];

  if (!kind || !targetId || files.length === 0) {
    return {
      ok: false as const,
      error: "Selecciona un objetivo (evaluación o compendio) y al menos un archivo.",
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
    return { ok: false as const, error: "Evaluación no encontrada." };
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
    return { ok: false as const, error: "Compendio no encontrado." };
  }
  // Solo compendios READY tienen clave unificada generada y admiten
  // calificación. Mismo chequeo que el reportador comparativo.
  if (bundle.status !== "READY") {
    return {
      ok: false as const,
      error: `El compendio debe estar en estado LISTO para escanear (actual: ${bundle.status}).`,
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
 *  hoja es de evaluación o bundle, y `targetId` se guarda en AnswerSheet
 *  para que el reporte comparativo del compendio pueda drill-dowmear
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

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() ?? "png";
    const filename = `sheet_${String(i + 1).padStart(3, "0")}.${ext}`;
    const relativePath = `${batchDir}/${filename}`;
    await localStorage.save(relativePath, bytes);

    const sheet = await prisma.answerSheet.create({
      data: {
        evaluationId: targetKind === "evaluation" ? targetId : null,
        bundleId: targetKind === "bundle" ? targetId : null,
        studentId: null,
        qrContent: "",
        qrSignature: "",
        scannedImage: relativePath,
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
  /** "evaluation" si el batch es de una evaluación, "bundle" si es de un
   *  compendio, "unknown" si la FK quedó null por datos legacy. */
  kind: ScanTargetKind | "unknown";
  status: string;
  totalSheets: number;
  processedSheets: number;
  createdAt: Date;
  /** Nombre del objetivo (evaluación o compendio). null si no se pudo
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
  const actor = await requireAuthenticatedUser("TEACHER");

  // Filtro multi-target: el batch pertenece a la institución y:
  //   - es de una evaluación del docente actual, o
  //   - es de un compendio de la institución (cualquier docente del
  //     colegio puede escanear, los compendios son institucionales).
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
