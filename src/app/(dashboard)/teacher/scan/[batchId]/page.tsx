import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { BatchReviewMatrix, type SheetRow } from "./batch-review-matrix";

export const metadata: Metadata = { title: "Revisión de hojas" };

interface Props {
  params: Promise<{ batchId: string }>;
}

/** Lee el `grid.json` compacto de una hoja (thr + [{n, ans}]) desde storage.
 *  Devuelve arreglo vacío si aún no se ha procesado. */
async function readGrid(
  batchId: string,
  sheetId: string,
): Promise<{ thr: number | null; answers: { n: number; ans: string }[] }> {
  try {
    const buf = await localStorage.read(`scans/${batchId}/sheet_${sheetId.slice(0, 8)}_grid.json`);
    const g = JSON.parse(buf.toString()) as {
      thr: number;
      answers: { n: number; ans: string }[];
    };
    return { thr: g.thr, answers: g.answers };
  } catch {
    return { thr: null, answers: [] };
  }
}

export default async function BatchReviewPage({ params }: Props) {
  const { batchId } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR", "ECU_MASTER");

  const batch = await prisma.scanBatch.findFirst({
    where: {
      id: batchId,
      institutionId: actor.institutionId,
      OR: [
        { evaluation: { institutionId: actor.institutionId } },
        { bundle: { institutionId: actor.institutionId } },
      ],
    },
    include: {
      evaluation: { select: { title: true } },
      bundle: { select: { name: true } },
      sheets: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          studentName: true,
          studentCode: true,
          status: true,
          score: true,
          totalCorrect: true,
          totalQuestions: true,
        },
      },
    },
  });
  if (!batch) notFound();

  const title = batch.evaluation?.title ?? batch.bundle?.name ?? "Lote de escaneo";

  const rows: SheetRow[] = await Promise.all(
    batch.sheets.map(async (s, i) => {
      const grid = await readGrid(batchId, s.id);
      const label = s.studentName ?? s.studentCode ?? `Hoja ${String(i + 1).padStart(3, "0")}`;
      return {
        id: s.id,
        label,
        status: s.status,
        score: s.score,
        totalCorrect: s.totalCorrect,
        totalQuestions: s.totalQuestions,
        thr: grid.thr,
        answers: grid.answers,
      };
    }),
  );

  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-sm">
        <Link href="/teacher/scan" className="text-muted-foreground hover:underline">
          ← Volver a escaneos
        </Link>
      </div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Revisión de hojas de respuestas
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {title} · Navega la matriz con las flechas del teclado; el visor muestra lo que el motor
          identificó en cada celda. Teclas A–H corrigen; Supr restaura.
        </p>
      </header>

      <BatchReviewMatrix batchId={batchId} rows={rows} />
    </>
  );
}
