import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { BatchReviewMatrix, type SheetRow } from "./batch-review-matrix";
import { nombreCompleto } from "@/modules/students/domain/nombre-completo";
import { makeListBundles } from "@/modules/bundles/infrastructure/container";
import { MOTIVOS, type MotivoSinClasificar } from "@/modules/scanning/domain/clasificar-hojas";
import { HojasSinClasificarCard, type HojaSinClasificarRow } from "./hojas-sin-clasificar-card";
import { estudiantesDelCuadernillo } from "../_lib/estudiantes-del-cuadernillo";

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
    // Id completo: ver el comentario en process-answer-sheet.ts (persistCells).
    const buf = await localStorage.read(`scans/${batchId}/sheet_${sheetId}_grid.json`);
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
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");

  const batch = await prisma.scanBatch.findFirst({
    where: {
      id: batchId,
      institutionId: actor.institutionId,
      OR: [
        { evaluation: { institutionId: actor.institutionId } },
        { bundle: { institutionId: actor.institutionId } },
        // Lote sin cuadernillo: carga automática donde ninguna hoja clasificó.
        { evaluationId: null, bundleId: null, unclassifiedScans: { some: {} } },
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
          // El QR resuelve `studentId`; el nombre vive en Student, no en las
          // columnas de respaldo. Sin este join la matriz mostraba "Hoja 001"
          // aunque la hoja estuviera perfectamente identificada.
          student: {
            select: {
              code: true,
              lastName1: true,
              lastName2: true,
              firstName1: true,
              firstName2: true,
            },
          },
          status: true,
          score: true,
          totalCorrect: true,
          totalQuestions: true,
          qrContent: true,
          scannedImage: true,
          originalFilename: true,
        },
      },
    },
  });
  if (!batch) notFound();

  // Lote sin cuadernillo: carga automática donde ninguna hoja clasificó. No
  // tiene hojas propias ni matriz, solo la card "Hojas sin clasificar".
  const sinCuadernillo = !batch.bundleId && !batch.evaluationId;
  const title =
    batch.evaluation?.title ??
    batch.bundle?.name ??
    (sinCuadernillo ? "Hojas sin clasificar" : "Lote de escaneo");

  const rows: SheetRow[] = await Promise.all(
    batch.sheets.map(async (s, i) => {
      const grid = await readGrid(batchId, s.id);
      // Prioridad: el estudiante resuelto por QR, luego lo escrito a mano,
      // y como ultimo recurso la posicion en el lote.
      const delQr = s.student ? nombreCompleto(s.student) : "";
      const label =
        delQr || s.studentName || s.studentCode || `Hoja ${String(i + 1).padStart(3, "0")}`;
      return {
        id: s.id,
        label,
        status: s.status,
        score: s.score,
        totalCorrect: s.totalCorrect,
        totalQuestions: s.totalQuestions,
        thr: grid.thr,
        answers: grid.answers,
        // "" cuando el QR no se pudo leer (la hoja quedo sin identificar).
        qrContent: s.qrContent || null,
        // El nombre con el que se subio, si se conoce. Los lotes anteriores a
        // la columna `originalFilename` caen al nombre ya renombrado
        // (sheet_NNN.ext), que es lo unico que quedo de ellos.
        fileName: s.originalFilename ?? (s.scannedImage ? s.scannedImage.split("/").pop()! : null),
      };
    }),
  );

  // Hojas de la carga automática que no se pudieron clasificar por su QR.
  // Solo las tiene el primer lote de cada carga (donde vive la carpeta).
  const sinClasificar = await prisma.unclassifiedScan.findMany({
    where: { scanBatchId: batchId, institutionId: actor.institutionId },
    orderBy: [{ createdAt: "asc" }, { filePath: "asc" }],
    select: {
      id: true,
      filePath: true,
      originalFilename: true,
      reason: true,
      resolvedAt: true,
      answerSheet: {
        select: {
          id: true,
          scanBatchId: true,
          status: true,
          bundle: { select: { name: true } },
          student: {
            select: { lastName1: true, lastName2: true, firstName1: true, firstName2: true },
          },
        },
      },
    },
  });
  const hojasSinClasificar: HojaSinClasificarRow[] = sinClasificar.map((h) => ({
    id: h.id,
    nombre: h.originalFilename ?? h.filePath.split("/").pop() ?? h.id,
    motivo: MOTIVOS[h.reason as MotivoSinClasificar] ?? h.reason,
    resuelta: h.resolvedAt
      ? {
          sheetId: h.answerSheet?.id ?? null,
          batchId: h.answerSheet?.scanBatchId ?? null,
          estudiante: h.answerSheet?.student ? nombreCompleto(h.answerSheet.student) : "",
          cuadernillo: h.answerSheet?.bundle?.name ?? "",
          // SCANNED solo le queda a una hoja cuyo job no entró a la cola
          // (Redis caído): hay que Reprocesarla desde su detalle.
          sinEncolar: h.answerSheet?.status === "SCANNED",
        }
      : null,
  }));
  const hayPendientes = hojasSinClasificar.some((h) => !h.resuelta);
  // Cuadernillos LISTOS con el mismo alcance por rol que la carga de lotes.
  const cuadernillos = hayPendientes
    ? await makeListBundles()
        .execute({ actor, filters: { status: "READY" } })
        .then((r) => (r.ok ? r.value.map((b) => ({ id: b.id, name: b.name })) : []))
    : [];
  const cuadernilloPorDefecto =
    batch.bundleId && cuadernillos.some((c) => c.id === batch.bundleId) ? batch.bundleId : "";
  const estudiantesIniciales = cuadernilloPorDefecto
    ? await estudiantesDelCuadernillo(actor.institutionId, cuadernilloPorDefecto)
    : [];

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
          {sinCuadernillo ? (
            title
          ) : (
            <>
              {title} · Navega la matriz con las flechas del teclado; el visor muestra lo que el
              motor identificó en cada celda. Teclas A–H corrigen; Supr restaura.
            </>
          )}
        </p>
      </header>

      {hojasSinClasificar.length > 0 && (
        <HojasSinClasificarCard
          batchId={batchId}
          hojas={hojasSinClasificar}
          cuadernillos={cuadernillos}
          cuadernilloPorDefecto={cuadernilloPorDefecto}
          estudiantesIniciales={estudiantesIniciales}
        />
      )}

      {/* El lote sin cuadernillo nunca tiene hojas: solo la card de arriba. */}
      {!sinCuadernillo && <BatchReviewMatrix batchId={batchId} rows={rows} />}
    </>
  );
}
