"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { getOmrScanQueue } from "@/shared/infrastructure/queue/queues";
import { requireAuthenticatedUser } from "@/lib/session";

export async function createScanBatchAction(formData: FormData) {
  const actor = await requireAuthenticatedUser("TEACHER");

  const evaluationId = formData.get("evaluationId") as string;
  const files = formData.getAll("files") as File[];

  if (!evaluationId || files.length === 0) {
    return { ok: false as const, error: "Selecciona una evaluación y al menos un archivo." };
  }

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
      uploadedBy: actor.userId,
      status: "PENDING",
      totalSheets: files.length,
      processedSheets: 0,
    },
  });

  const queue = getOmrScanQueue();
  const batchDir = `scans/${batch.id}`;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() ?? "png";
    const filename = `sheet_${String(i + 1).padStart(3, "0")}.${ext}`;
    const relativePath = `${batchDir}/${filename}`;
    await localStorage.save(relativePath, bytes);

    const sheet = await prisma.answerSheet.create({
      data: {
        evaluationId,
        studentId: null,
        qrContent: "",
        qrSignature: "",
        scannedImage: relativePath,
        scanBatchId: batch.id,
        status: "PENDING",
      },
    });

    await queue.add("omr-scan", {
      answerSheetId: sheet.id,
      scanBatchId: batch.id,
      institutionId: actor.institutionId,
      imagePath: relativePath,
    });
  }

  revalidatePath("/teacher/scan");
  return { ok: true as const, batchId: batch.id };
}

export interface BatchWithSheets {
  id: string;
  status: string;
  totalSheets: number;
  processedSheets: number;
  createdAt: Date;
  evaluationTitle: string;
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

  const rows = await prisma.scanBatch.findMany({
    where: { institutionId: actor.institutionId, evaluation: { teacherId: actor.userId } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      evaluation: { select: { title: true } },
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

  return rows.map((b) => ({
    id: b.id,
    status: b.status,
    totalSheets: b.totalSheets,
    processedSheets: b.processedSheets,
    createdAt: b.createdAt,
    evaluationTitle: b.evaluation!.title,
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
  }));
}
